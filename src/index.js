/**
 * Vimage - Unsplash图片代理服务
 * 主入口文件
 */

require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const db = require('./db/init');
const { cleanupLogs } = require('./db/logger');

const { createImageRouter } = require('./routes/image');
const { createResolveRouter } = require('./routes/resolve');
const apiRouter = require('./routes/api');
const {
  requireAdminAuth,
  showLoginPage,
  handleLogin,
  handleLogout,
  loginRateLimiter
} = require('./middleware/adminAuth');

const app = express();
const PORT = process.env.PORT || 7749;
app.disable('x-powered-by');

// 中间件
app.use(express.json({ limit: '8kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});
app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
app.use(['/login', '/login.html', '/logout', '/dashboard', '/dashboard.html', '/dashboard.css', '/dashboard.js', '/api'], (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Referrer-Policy': 'same-origin'
  });
  next();
});
app.use('/api/images', createResolveRouter());
app.use(['/dashboard', '/dashboard.html', '/dashboard.css', '/dashboard.js', '/api'], requireAdminAuth);

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// 路由
// 忽略浏览器自动请求的favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get(['/login', '/login.html'], showLoginPage);
app.post('/login', loginRateLimiter, handleLogin);
app.post('/logout', handleLogout);

app.get(['/dashboard', '/dashboard.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/dashboard.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.css')));
app.get('/dashboard.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.js')));

app.use('/api', apiRouter);
app.use('/', createImageRouter());

// 404处理
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found'
  });
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  console.error(`Request failed: ${req.method} ${req.path} (${status})`);
  res.set('Cache-Control', 'no-store').status(status).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred'
  });
});

function startServer() {
  const maintenanceTimer = setInterval(() => {
    try {
      cleanupLogs();
    } catch (error) {
      console.error('Log cleanup failed:', error.message);
    }
  }, 60000);
  maintenanceTimer.unref();
  const server = app.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════╗
  ║   Vimage服务已启动                     ║
  ╠═══════════════════════════════════════╣
  ║  端口: ${PORT.toString().padEnd(32)}║
  ║  监控面板: http://localhost:${PORT}/dashboard${' '.repeat(3)}║
  ║  环境: ${(process.env.NODE_ENV || 'development').padEnd(32)}║
  ╚═══════════════════════════════════════╝
  `);
  });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(maintenanceTimer);
    const shutdownTimer = setTimeout(() => process.exit(1), 25000);
    shutdownTimer.unref();
    server.close(() => {
      db.close();
      clearTimeout(shutdownTimer);
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) startServer();

module.exports = { app, startServer };
