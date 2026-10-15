const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('image thumbnails are enabled by default on the dashboard', () => {
  const markup = fs.readFileSync(path.join(__dirname, '../src/public/dashboard.html'), 'utf8');
  const checkbox = markup.match(/<input\b[^>]*\bid="showPreviews"[^>]*>/)?.[0];
  assert.ok(checkbox);
  assert.match(checkbox, /\bchecked(?:\s|>|=)/);
});

test('detail images fit within a maximum height without cropping or stretching', () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, '../src/public/dashboard.css'), 'utf8');
  const rule = stylesheet.match(/\.detail-preview img\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /(?:^|;)\s*width:\s*auto\s*;/);
  assert.match(rule, /(?:^|;)\s*height:\s*auto\s*;/);
  assert.match(rule, /max-width:\s*100%\s*;/);
  assert.match(rule, /max-height:\s*360px\s*;/);
  assert.match(rule, /object-fit:\s*contain\s*;/);
});

test('detail previews retain returned image URLs while list thumbnails stay small', () => {
  const { client } = createClient();
  const unsplash = 'https://images.unsplash.com/photo-test?w=1080&q=80';
  const picsum = 'https://picsum.photos/400/1200?random=123';
  for (const url of [unsplash, picsum]) {
    const preview = client.imagePreview({ final_url: url, query_term: 'test' }, true);
    assert.equal(preview.children[0].src, url);
    assert.equal(preview.href, url);
  }
  const thumbnail = client.imagePreview({ final_url: unsplash });
  assert.equal(new URL(thumbnail.children[0].src).searchParams.get('w'), '160');
  const fallbackThumbnail = client.imagePreview({ final_url: picsum });
  assert.equal(new URL(fallbackThumbnail.children[0].src).pathname, '/160/112');
});

function createClient(responseStatus = 200) {
  const source = fs.readFileSync(path.join(__dirname, '../src/public/dashboard.js'), 'utf8');
  const bootstrap = source.indexOf("document.querySelectorAll('[data-view]').forEach(button => button.addEventListener");
  assert.ok(bootstrap > 0);
  const redirects = [];
  const context = {
    URL, URLSearchParams,
    document: {
      createElement: () => ({
        children: [],
        setAttribute() {},
        addEventListener() {},
        append(child) { this.children.push(child); }
      })
    },
    fetch: async () => ({ status: responseStatus, ok: responseStatus === 200, json: async () => ({ ok: true }) }),
    window: { location: { pathname: '/dashboard', search: '?view=logs&q=cat&sort=slowest', assign: value => redirects.push(value) } }
  };
  vm.runInNewContext(source.slice(0, bootstrap) + '\nglobalThis.client = { fetchJson, safeImageUrl, imagePreview, readLocation, snapshot: () => ({ ...state }) };', context);
  return { client: context.client, location: context.window.location, redirects };
}

test('concurrent expired-session responses redirect once and preserve the log view', async () => {
  const { client, redirects } = createClient(401);
  const results = await Promise.allSettled([client.fetchJson('/api/stats'), client.fetchJson('/api/logs')]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(redirects.length, 1);
  const redirect = new URL(redirects[0], 'http://localhost');
  assert.equal(redirect.pathname, '/login');
  assert.equal(redirect.searchParams.get('redirect'), '/dashboard?view=logs&q=cat&sort=slowest');
});

test('dashboard restores only supported filters and restricts preview URLs', () => {
  const { client, location } = createClient();
  client.readLocation();
  assert.equal(client.snapshot().view, 'logs');
  assert.equal(client.snapshot().q, 'cat');
  assert.equal(client.snapshot().sort, 'slowest');
  location.search = '?type=error&status=success&source=cache&limit=10000&page=-1&sort=invalid';
  client.readLocation();
  assert.equal(client.snapshot().status, 'all');
  assert.equal(client.snapshot().source, 'all');
  assert.equal(client.snapshot().limit, 20);
  assert.equal(client.snapshot().page, 1);
  assert.equal(client.snapshot().sort, 'newest');
  for (const value of ['javascript:alert(1)', 'http://images.unsplash.com/a', 'https://images.unsplash.com.evil.invalid/a', 'https://user:password@images.unsplash.com/a']) {
    assert.equal(client.safeImageUrl(value), null);
  }
  assert.equal(client.safeImageUrl('https://images.unsplash.com/photo-test').hostname, 'images.unsplash.com');
});
