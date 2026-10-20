const ASSET_HOST = 'raw.githubusercontent.com';
const REPOSITORY_PATH = 'VictorSicsu/innyx-webar/main/assets';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return res.status(405).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const experienceId = String(req.query.experienceId || '');
  const version = String(req.query.version || '');
  const fileName = String(req.query.filename || '');
  if (!/^[a-f0-9-]{36}$/i.test(experienceId)
    || !/^\d{10,16}$/.test(version)
    || !/^marker\.(fset|fset3|iset)$/.test(fileName)) {
    return res.status(400).json({ error: 'Invalid marker descriptor path.' });
  }

  const url = `https://${ASSET_HOST}/${REPOSITORY_PATH}/${encodeURIComponent(experienceId)}/${encodeURIComponent(version)}/${encodeURIComponent(fileName)}`;
  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'Marker descriptor is unavailable.' });
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length) return res.status(502).json({ error: 'Marker descriptor is empty.' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', 'inline');
    return res.status(200).send(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    console.error('[InnyxWebAR] Marker descriptor proxy failed:', error);
    return res.status(502).json({ error: 'Could not load marker descriptor from GitHub.' });
  }
};

