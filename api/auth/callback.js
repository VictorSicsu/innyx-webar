const crypto = require('node:crypto');
const { config, repoName, appJwt, installationToken, setCookie, clearCookie, writeEncryptedCookie, redirect, githubRequest, methodNotAllowed } = require('../../lib/github');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!config().configured) return redirect(res, '/?auth=setup-required');

  const params = new URL(req.url, process.env.APP_URL).searchParams;
  if (params.has('error')) return redirect(res, '/?auth=cancelled');
  const cookies = String(req.headers.cookie || '').split(';').reduce((result, part) => {
    const index = part.indexOf('=');
    if (index > 0) { try { result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch {} }
    return result;
  }, {});
  const state = params.get('state');
  const expectedState = cookies.innyx_auth_state || '';
  const validState = state && expectedState && Buffer.byteLength(state) === Buffer.byteLength(expectedState) && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState));
  if (!validState) {
    clearCookie(res, 'innyx_auth_state');
    return redirect(res, '/?auth=invalid-state');
  }

  try {
    const form = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: params.get('code') || '' });
    const { body: tokenBody } = await githubRequest('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString()
    });
    if (!tokenBody.access_token) throw new Error('O GitHub não retornou uma sessão de autorização.');
    const { body: user } = await githubRequest('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokenBody.access_token}` } });
    if (!user.login) throw new Error('Não foi possível identificar a conta GitHub.');

    // Reuse the installed App so returning users do not have to install it again.
    let installation;
    const repositoryPath = `${encodeURIComponent(user.login)}/${encodeURIComponent(repoName())}`;
    try {
      ({ body: installation } = await githubRequest(`https://api.github.com/repos/${repositoryPath}/installation`, {
        headers: { Authorization: `Bearer ${appJwt()}` }
      }));
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (installation) {
      if (installation.account?.login?.toLowerCase() !== user.login.toLowerCase() || installation.suspended_at) {
        throw new Error('A instalação não está disponível para esta conta.');
      }
      const access = await installationToken(installation.id, null, 'read');
      const { body: repository } = await githubRequest(`https://api.github.com/repos/${repositoryPath}`, {
        headers: { Authorization: `Bearer ${access.token}` }
      });
      if (!repository.id || repository.full_name?.toLowerCase() !== `${user.login}/${repoName()}`.toLowerCase()) {
        throw new Error('Repositório diferente do autorizado.');
      }
      if (repository.private) return redirect(res, '/?auth=public-repo-required');
      writeEncryptedCookie(res, 'innyx_session', {
        login: user.login,
        avatarUrl: user.avatar_url || '',
        installationId: String(installation.id),
        repositoryId: repository.id,
        owner: user.login,
        repo: repository.name,
        expiresAt: Date.now() + 8 * 60 * 60 * 1000
      }, 8 * 60 * 60);
      clearCookie(res, 'innyx_auth_state');
      clearCookie(res, 'innyx_pending_install');
      return redirect(res, '/?auth=connected');
    }

    const installationState = crypto.randomBytes(24).toString('base64url');
    writeEncryptedCookie(res, 'innyx_pending_install', { login: user.login, avatarUrl: user.avatar_url || '', installationState }, 600);
    // GitHub returns installation OAuth to this callback with the same state.
    setCookie(res, 'innyx_auth_state', installationState, 600);
    const installationUrl = new URL(`https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG)}/installations/new`);
    installationUrl.searchParams.set('state', installationState);
    res.statusCode = 302;
    res.setHeader('Location', installationUrl.toString());
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  } catch {
    clearCookie(res, 'innyx_auth_state');
    return redirect(res, '/?auth=oauth-error');
  }
};

