const { config, getSession, json, methodNotAllowed } = require('../../lib/github');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = getSession(req);
  json(res, 200, session
    ? { configured: config().configured, authenticated: true, user: { login: session.login, avatarUrl: session.avatarUrl }, repository: { owner: session.owner, name: session.repo, id: session.repositoryId, branch: 'main' } }
    : { configured: config().configured, authenticated: false });
};
