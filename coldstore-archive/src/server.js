const express = require('express');
const path = require('path');
require('./db'); // 初始化数据库

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/dict', require('./routes/dict'));
app.use('/api/equipment', require('./routes/equipment'));
app.use('/api/users', require('./routes/users'));

// multer / 业务错误兜底
app.use((err, _req, res, _next) => {
  const status = err.name === 'MulterError' || /格式|大小/.test(err.message) ? 400 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

// SPA 回退 (Express 5 不支持正则路由，用中间件实现)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`冷库设备档案服务已启动: http://localhost:${PORT}`));
