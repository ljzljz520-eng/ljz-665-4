// 冷库设备档案系统 —— 应用入口
require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');

const authRoutes = require('./routesAuth');
const equipmentRoutes = require('./routesEquipment');
const manualRoutes = require('./routesManuals');

const app = express();
app.use(express.json({ limit: '1mb' }));

// 简单访问日志
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/equipment', manualRoutes);

// 统一错误处理
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 前端静态资源
const webDir = path.join(__dirname, '..', '..', 'web');
app.use(express.static(webDir));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`冷库设备档案系统已启动: http://localhost:${PORT}`));

process.on('SIGTERM', () => { server.close(() => { db.close(); process.exit(0); }); });
module.exports = app;
