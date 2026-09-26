// 认证与当前用户信息
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { signToken, authRequired } = require('./middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });

  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
  });
});

// 当前登录用户 + 可见菜单/操作权限（前端按此渲染菜单与按钮）
router.get('/me', authRequired, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    permissions: {
      equipmentView:    true,
      equipmentCreate:  ['manager', 'admin'].includes(u.role),
      equipmentEdit:    ['manager', 'admin'].includes(u.role),
      equipmentDelete:  u.role === 'admin',
      manualUpload:     ['operator', 'manager', 'admin'].includes(u.role), // 运维员可上传
      manualDelete:     ['manager', 'admin'].includes(u.role),
      userManage:       u.role === 'admin',
    },
  });
});

module.exports = router;
