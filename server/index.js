'use strict';
// 注意：必须先加载 .env，再 require 任何读取环境变量的模块（db、routes 等）
require('./env');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { db, migrate } = require('./db');
const authRoutes = require('./routes/auth');
const equipmentRoutes = require('./routes/equipment');
const manualRoutes = require('./routes/manuals');
const userRoutes = require('./routes/users');

// 启动即迁移（幂等）
migrate();

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'cs_sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 8 * 60 * 60 * 1000 // 8 小时
  }
}));

// 简单请求日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api', manualRoutes);
app.use('/api/users', userRoutes);

// 统一错误处理
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 静态前端
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`冷库设备档案系统已启动: http://${HOST}:${PORT}`);
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (users === 0) {
      console.log('提示: 尚未初始化用户，请执行 npm run seed');
    }
  });
}

module.exports = app;
