const crypto = require('node:crypto');
const { config, setCookie, redirect, methodNotAllowed } = require('../../lib/github');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!config().configured) return redirect(res, '/?auth=setup-required');

  const state = crypto.randomBytes(24).toString('base64url');
  setCookie(res, 'innyx_auth_state', state, 600);
  const callback = new URL('/api/auth/callback', process.env.APP_URL).toString();
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', callback);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'false');
  res.statusCode = 302;
  res.setHeader('Location', authorize.toString());
  res.setHeader('Cache-Control', 'no-store');
  res.end();
};
