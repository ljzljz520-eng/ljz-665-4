'use strict';
const express = require('express');
const { db } = require('../db');
const { hashPassword, verifyPassword } = require('../auth');

const router = express.Router();

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.user = {
    id: user.id, username: user.username, realName: user.real_name, role: user.role
  };
  res.json({ data: req.session.user });
});

// 退出
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ data: { ok: true } }));
});

// 当前登录用户
router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '未登录' });
  res.json({ data: req.session.user });
});

module.exports = router;
