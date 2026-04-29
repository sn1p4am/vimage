/**
 * Vimage - Unsplash图片代理服务
 * 主入口文件
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

const imageRouter = require('./routes/image');
const apiRouter = require('./routes/api');
const {
  requireAdminAuth,
  showLoginPage,
  handleLogin,
  handleLogout
} = require('./middleware/adminAuth');

const app = express();
const PORT = process.env.PORT || 7749;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(['/dashboard', '/dashboard.html', '/api/logs'], requireAdminAuth);
app.use(express.static(path.join(__dirname, 'public')));

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// 路由
// 忽略浏览器自动请求的favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/login', showLoginPage);
app.post('/login', handleLogin);
app.post('/logout', handleLogout);

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.use('/api', apiRouter);
app.use('/', imageRouter);

// 404处理
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found'
  });
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // 记录错误
  const errorLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    error: err.message,
    stack: err.stack
  };

  console.error('Error details:', errorLog);

  // 对于图片请求，返回Picsum随机图片
  if (req.path.startsWith('/vimage_')) {
    return res.redirect(302, `https://picsum.photos/1200/800?random=${Date.now()}`);
  }

  // 其他请求返回JSON错误
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
});

// 启动服务器
app.listen(PORT, () => {
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

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  process.exit(0);
});
