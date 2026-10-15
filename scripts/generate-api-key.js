const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const destination = path.resolve(process.argv[2] || '.secrets/image-api-key');
fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
const key = randomBytes(32).toString('base64url');
fs.writeFileSync(destination, key + '\n', { flag: 'wx', mode: 0o600 });
console.log(`API key saved to ${destination}; keep it outside the Agent sandbox.`);
console.log(`IMAGE_API_KEY_HASHES=${createHash('sha256').update(key).digest('hex')}`);
