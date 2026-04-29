/**
 * Basic Auth middleware for sensitive admin endpoints.
 */

const crypto = require('crypto');

const isEnabled = process.env.BASIC_AUTH_ENABLED !== 'false';
const username = process.env.BASIC_AUTH_USERNAME;
const password = process.env.BASIC_AUTH_PASSWORD;
const realm = process.env.BASIC_AUTH_REALM || 'Vimage';

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual || '', 'utf8');
  const expectedBuffer = Buffer.from(expected || '', 'utf8');

  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requestAuth(res) {
  res.set('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
  return res.status(401).send('Authentication required');
}

function basicAuth(req, res, next) {
  if (!isEnabled) {
    return next();
  }

  if (!username || !password) {
    return res.status(503).json({
      error: 'Basic auth is enabled but BASIC_AUTH_USERNAME or BASIC_AUTH_PASSWORD is not configured'
    });
  }

  const header = req.headers.authorization || '';
  const [scheme, encodedCredentials] = header.split(' ');

  if (scheme !== 'Basic' || !encodedCredentials) {
    return requestAuth(res);
  }

  let decoded;
  try {
    decoded = Buffer.from(encodedCredentials, 'base64').toString('utf8');
  } catch (error) {
    return requestAuth(res);
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    return requestAuth(res);
  }

  const suppliedUsername = decoded.slice(0, separatorIndex);
  const suppliedPassword = decoded.slice(separatorIndex + 1);

  if (safeEqual(suppliedUsername, username) && safeEqual(suppliedPassword, password)) {
    return next();
  }

  return requestAuth(res);
}

module.exports = basicAuth;
