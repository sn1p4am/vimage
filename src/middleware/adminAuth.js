/**
 * Cookie-based admin authentication for the dashboard and log API.
 */

const crypto = require('crypto');

const COOKIE_NAME = 'vimage_admin_session';
const isEnabled = process.env.ADMIN_AUTH_ENABLED
  ? process.env.ADMIN_AUTH_ENABLED !== 'false'
  : process.env.BASIC_AUTH_ENABLED !== 'false';
const username = process.env.ADMIN_USERNAME || process.env.BASIC_AUTH_USERNAME;
const password = process.env.ADMIN_PASSWORD || process.env.BASIC_AUTH_PASSWORD;
const sessionSecret = process.env.ADMIN_SESSION_SECRET || password;
const sessionTtl = parseInt(process.env.ADMIN_SESSION_TTL, 10) || 43200;
const cookieSecure = process.env.ADMIN_COOKIE_SECURE === 'true';

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual || '', 'utf8');
  const expectedBuffer = Buffer.from(expected || '', 'utf8');

  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';

  header.split(';').forEach(cookie => {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }

    const key = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch (error) {
      cookies[key] = value;
    }
  });

  return cookies;
}

function sign(payload) {
  return crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url');
}

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({
    username,
    exp: Date.now() + sessionTtl * 1000
  })).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!isEnabled) {
    return true;
  }

  if (!sessionSecret || !username || !password || !token) {
    return false;
  }

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) {
    return false;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.username === username && session.exp > Date.now();
  } catch (error) {
    return false;
  }
}

function getRedirectUrl(req) {
  const redirect = req.query.redirect || req.body.redirect || '/dashboard';
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
    ? redirect
    : '/dashboard';
}

function setSessionCookie(res) {
  const secureFlag = cookieSecure ? '; Secure' : '';

  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${encodeURIComponent(createSessionToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionTtl}${secureFlag}`
  ]);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function ensureConfigured(res) {
  if (!isEnabled) {
    return true;
  }

  if (username && password && sessionSecret) {
    return true;
  }

  res.status(503).json({
    error: 'Admin auth is enabled but ADMIN_USERNAME or ADMIN_PASSWORD is not configured'
  });
  return false;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function requireAdminAuth(req, res, next) {
  if (!ensureConfigured(res)) {
    return;
  }

  if (!isEnabled || isAuthenticated(req)) {
    return next();
  }

  if ((req.originalUrl || req.path).startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  return res.redirect(302, `/login?redirect=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
}

function showLoginPage(req, res) {
  if (!ensureConfigured(res)) {
    return;
  }

  if (!isEnabled || isAuthenticated(req)) {
    return res.redirect(302, getRedirectUrl(req));
  }

  return res.sendFile('login.html', { root: `${__dirname}/../public` });
}

function handleLogin(req, res) {
  if (!ensureConfigured(res)) {
    return;
  }

  const suppliedUsername = req.body.username || '';
  const suppliedPassword = req.body.password || '';
  const redirectUrl = getRedirectUrl(req);

  if (safeEqual(suppliedUsername, username) && safeEqual(suppliedPassword, password)) {
    setSessionCookie(res);
    return res.redirect(302, redirectUrl);
  }

  return res.redirect(302, `/login?error=1&redirect=${encodeURIComponent(redirectUrl)}`);
}

function handleLogout(req, res) {
  clearSessionCookie(res);
  return res.redirect(302, '/login');
}

module.exports = {
  requireAdminAuth,
  showLoginPage,
  handleLogin,
  handleLogout
};
