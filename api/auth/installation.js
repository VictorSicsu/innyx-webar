const { config, repoName, appJwt, githubRequest, installationToken, readEncryptedCookie, writeEncryptedCookie, clearCookie, redirect, methodNotAllowed } = require('../../lib/github');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!config().configured) return redirect(res, '/?auth=setup-required');
  const params = new URL(req.url, process.env.APP_URL).searchParams;
  const pending = readEncryptedCookie(req, 'innyx_pending_install');
  const installationId = params.get('installation_id');
  const setupAction = params.get('setup_action');
  if (!pending || !installationId || !['install', 'update'].includes(setupAction) || !params.get('state') || params.get('state') !== pending.installationState) {
    clearCookie(res, 'innyx_pending_install');
    return redirect(res, '/?auth=install-state-error');
  }

  try {
    const { body: installation } = await githubRequest(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}`, {
      headers: { Authorization: `Bearer ${appJwt()}` }
    });
    const owner = installation.account?.login;
    if (!owner || owner.toLowerCase() !== pending.login.toLowerCase()) throw new Error('A instalação não pertence à conta GitHub conectada.');

    const broadToken = await installationToken(installationId, null, 'read');
    let page = 1;
    let target = null;
    while (page <= 10 && !target) {
      const { body } = await githubRequest(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${broadToken.token}` }
      });
      target = (body.repositories || []).find((repository) => repository.full_name.toLowerCase() === `${owner}/${repoName()}`.toLowerCase());
      if (!target || (body.repositories || []).length < 100) break;
      page += 1;
    }
    if (!target) {
      clearCookie(res, 'innyx_pending_install');
      return redirect(res, '/?auth=repo-required');
    }
    if (target.private) {
      clearCookie(res, 'innyx_pending_install');
      return redirect(res, '/?auth=public-repo-required');
    }

    writeEncryptedCookie(res, 'innyx_session', {
      login: pending.login,
      avatarUrl: pending.avatarUrl,
      installationId: String(installationId),
      repositoryId: target.id,
      owner,
      repo: target.name,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000
    }, 8 * 60 * 60);
    clearCookie(res, 'innyx_pending_install');
    return redirect(res, '/?auth=connected');
  } catch {
    clearCookie(res, 'innyx_pending_install');
    return redirect(res, '/?auth=install-error');
  }
};
