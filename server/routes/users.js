'use strict';
const express = require('express');
const { db } = require('../db');
const { hashPassword, requireRole } = require('../auth');

const router = express.Router();
const ROLES = ['viewer', 'manager', 'admin'];

// 用户列表（仅 admin）
router.get('/', requireRole(3), (_req, res) => {
  const rows = db.prepare(
    'SELECT id, username, real_name, role, active, created_at FROM users ORDER BY id'
  ).all();
  res.json({ data: rows });
});

// 新建用户（仅 admin）
router.post('/', requireRole(3), (req, res) => {
  const { username, password, real_name, role } = req.body || {};
  if (!username || !password || !real_name) {
    return res.status(400).json({ error: '用户名、密码、姓名不能为空' });
  }
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: '角色非法' });
  try {
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, real_name, role) VALUES (?, ?, ?, ?)'
    ).run(username.trim(), hashPassword(password), real_name.trim(), role);
    res.status(201).json({
      data: db.prepare('SELECT id, username, real_name, role, active FROM users WHERE id = ?')
        .get(info.lastInsertRowid)
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '用户名已存在' });
    throw e;
  }
});

// 重置密码 / 调整角色 / 启停
router.put('/:id', requireRole(3), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const { password, role, active } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: '角色非法' });
  }
  // 不允许停用自己，避免锁死
  if (active === 0 && Number(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: '不能停用当前登录账号' });
  }
  db.prepare(`UPDATE users SET
      password_hash = COALESCE(?, password_hash),
      role = COALESCE(?, role),
      active = COALESCE(?, active)
    WHERE id = ?`).run(
      password ? hashPassword(password) : null,
      role || null,
      active === undefined ? null : (active ? 1 : 0),
      user.id
    );
  res.json({
    data: db.prepare('SELECT id, username, real_name, role, active FROM users WHERE id = ?')
      .get(user.id)
  });
});

module.exports = router;
