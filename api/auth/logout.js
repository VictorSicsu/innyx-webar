const { clearCookie, githubRequest, json, methodNotAllowed } = require('../../lib/github');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const suppliedToken = typeof req.body?.token === 'string' ? req.body.token : '';
  if (/^ghs_[A-Za-z0-9_]{20,}$/.test(suppliedToken)) {
    await githubRequest('https://api.github.com/installation/token', { method: 'DELETE', headers: { Authorization: `Bearer ${suppliedToken}` } }).catch(() => {});
  }
  clearCookie(res, 'innyx_session');
  clearCookie(res, 'innyx_pending_install');
  return json(res, 200, { ok: true });
};
