const { createHash, timingSafeEqual } = require('node:crypto');

function createImageApiAuth(keyHashes) {
  const accepted = keyHashes.map(hash => Buffer.from(hash, 'hex'));
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!accepted.length) {
      return res.status(503).json({ error: 'Image API keys are not configured' });
    }
    const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(req.get('authorization') || '');
    const digest = createHash('sha256').update(match ? match[1] : '').digest();
    let valid = false;
    for (const expected of accepted) valid = timingSafeEqual(digest, expected) || valid;
    if (!match || !valid) {
      res.set('WWW-Authenticate', 'Bearer realm="vimage"');
      return res.status(401).json({ error: 'A valid image API key is required' });
    }
    req.imageApiKeyHash = digest.toString('hex');
    next();
  };
}

module.exports = { createImageApiAuth };
