const { randomBytes } = require('node:crypto');

function validateUpstreamUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'images.unsplash.com'
    || url.port || url.username || url.password || url.hash
    || !/^\/photo-[a-zA-Z0-9-]+$/.test(url.pathname)) {
    throw new Error('Unsupported image upstream');
  }
  return url.href;
}

function createAssetStore(db) {
  const byUrl = db.prepare('SELECT * FROM image_assets WHERE upstream_url = ?');
  const byId = db.prepare('SELECT * FROM image_assets WHERE id = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO image_assets (id, upstream_url, created_at) VALUES (?, ?, ?)');
  return {
    get(id) {
      return /^[a-f0-9]{32}$/.test(id) ? byId.get(id) : undefined;
    },
    save(value) {
      const url = validateUpstreamUrl(value);
      insert.run(randomBytes(16).toString('hex'), url, Date.now());
      return byUrl.get(url);
    }
  };
}

module.exports = { createAssetStore, validateUpstreamUrl };
