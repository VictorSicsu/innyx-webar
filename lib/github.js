const crypto = require('node:crypto');

function config() {
  const required = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_SESSION_SECRET', 'APP_URL'];
  const missing = required.filter((name) => !process.env[name]);
  return { configured: missing.length === 0, missing };
}
function repoName() { return (process.env.GITHUB_REPO_NAME || 'innyx-webar').trim(); }
function secretKey() {
  const value = process.env.GITHUB_SESSION_SECRET || '';
  if (value.length < 32) throw new Error('GITHUB_SESSION_SECRET precisa ter pelo menos 32 caracteres.');
  return crypto.createHash('sha256').update(value).digest();
}
function base64url(buffer) { return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function unbase64url(value) { return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(base64url).join('.');
}
function decrypt(value) {
  try {
    const [ivPart, tagPart, bodyPart] = String(value || '').split('.');
    if (!ivPart || !tagPart || !bodyPart) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), unbase64url(ivPart));
    decipher.setAuthTag(unbase64url(tagPart));
    return JSON.parse(Buffer.concat([decipher.update(unbase64url(bodyPart)), decipher.final()]).toString('utf8'));
  } catch { return null; }
}
function cookieMap(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index > 0) {
      try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch {}
    }
    return cookies;
  }, {});
}
function setCookie(res, name, value, maxAge = 600) {
  const secure = new URL(process.env.APP_URL || 'https://innyx-webar.vercel.app').protocol === 'https:' ? '; Secure' : '';
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, maxAge)}${secure}`;
  const current = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', current ? [...(Array.isArray(current) ? current : [current]), cookie] : cookie);
}
function clearCookie(res, name) { setCookie(res, name, '', 0); }
function readEncryptedCookie(req, name) { return decrypt(cookieMap(req)[name]); }
function writeEncryptedCookie(res, name, value, maxAge = 600) { setCookie(res, name, encrypt(value), maxAge); }
function getSession(req) {
  const session = readEncryptedCookie(req, 'innyx_session');
  if (!session || !session.expiresAt || session.expiresAt < Date.now()) return null;
  return session;
}
function privateKey() { return String(process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n'); }
function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 8 * 60, iss: process.env.GITHUB_APP_ID }));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${base64url(crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey()))}`;
}
async function githubRequest(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.message || `GitHub respondeu ${response.status}.`); error.status = response.status; throw error; }
  return { body, response };
}
async function installationToken(installationId, repositoryId, contentsPermission = 'write') {
  const body = { permissions: { contents: contentsPermission, metadata: 'read' } };
  if (repositoryId) body.repository_ids = [repositoryId];
  const { body: result } = await githubRequest(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST', headers: { Authorization: `Bearer ${appJwt()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return result;
}
function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }
function redirect(res, path) { res.statusCode = 302; res.setHeader('Location', new URL(path, process.env.APP_URL || 'https://innyx-webar.vercel.app').toString()); res.setHeader('Cache-Control', 'no-store'); res.end(); }
function methodNotAllowed(res, methods) { res.setHeader('Allow', methods.join(', ')); json(res, 405, { error: 'Método não permitido.' }); }

module.exports = { config, repoName, setCookie, clearCookie, readEncryptedCookie, writeEncryptedCookie, getSession, appJwt, githubRequest, installationToken, json, redirect, methodNotAllowed };
