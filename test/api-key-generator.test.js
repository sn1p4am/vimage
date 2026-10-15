const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('key generation creates private credentials, prints only a hash, and refuses overwrites', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vimage-key-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, '.secrets', 'client-key');
  const script = path.join(__dirname, '../scripts/generate-api-key.js');
  const output = execFileSync(process.execPath, [script, destination], { encoding: 'utf8' });
  const key = fs.readFileSync(destination, 'utf8').trim();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(destination)).mode & 0o777, 0o700);
  assert.equal(output.includes(key), false);
  assert.ok(output.includes(`IMAGE_API_KEY_HASHES=${createHash('sha256').update(key).digest('hex')}`));
  assert.throws(() => execFileSync(process.execPath, [script, destination], { stdio: 'pipe' }), error => /EEXIST/.test(error.stderr.toString()));
  assert.equal(fs.readFileSync(destination, 'utf8').trim(), key);
});
