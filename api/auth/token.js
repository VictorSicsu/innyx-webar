const { config, getSession, installationToken, json, methodNotAllowed } = require('../../lib/github');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const session = getSession(req);
  if (!session) return json(res, 401, { error: 'Entre com o GitHub novamente.' });
  if (!config().configured) return json(res, 503, { error: 'A integração do GitHub ainda não foi configurada no Vercel.' });
  try {
    const result = await installationToken(session.installationId, session.repositoryId);
    res.setHeader('Cache-Control', 'no-store');
    return json(res, 200, { token: result.token, expiresAt: result.expires_at, repository: `${session.owner}/${session.repo}` });
  } catch (error) {
    const status = error.status === 401 ? 401 : 502;
    return json(res, status, { error: status === 401 ? 'A instalação do GitHub expirou ou foi removida.' : 'Não foi possível renovar a conexão com o GitHub.' });
  }
};
