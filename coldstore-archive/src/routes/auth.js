const express = require('express');
const { db } = require('../db');
const { hashPassword, signToken, authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

  const row = db.prepare(
    `SELECT u.*, r.code AS role_code FROM users u
     JOIN roles r ON r.id = u.role_id WHERE u.username = ?`
  ).get(username);
  if (!row || !row.active) return res.status(401).json({ error: '用户名或密码错误' });

  const given = hashPassword(String(password), row.salt);
  if (given !== row.password_hash) return res.status(401).json({ error: '用户名或密码错误' });

  const token = signToken({ sub: row.id, role: row.role_code, iat: Date.now() });
  res.json({ token, user: {
    id: row.id, username: row.username, displayName: row.display_name, role: row.role_code,
  }});
});

// 当前用户信息 + 权限 + 可见菜单
router.get('/me', authenticate, (req, res) => {
  const u = req.user;
  const menus = db.prepare(
    `SELECT code,name,path,icon FROM menus
     WHERE permission_code IN (SELECT p.code FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?)
     ORDER BY sort_no`
  ).all(u.role_id);
  res.json({
    id: u.id, username: u.username, displayName: u.display_name,
    role: u.role_code, roleName: u.role_name,
    permissions: u.permissions, menus,
  });
});

module.exports = router;
