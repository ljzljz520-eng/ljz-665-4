const express = require('express');
const { db } = require('../db');
const { hashPassword, authenticate, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requirePerm('user:manage'));

router.get('/', (_req, res) => {
  res.json(db.prepare(
    `SELECT u.id, u.username, u.display_name, u.active, u.created_at,
            r.code AS role_code, r.name AS role_name
     FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id`
  ).all());
});

router.get('/roles', (_req, res) => {
  const roles = db.prepare(
    `SELECT r.id, r.code, r.name,
      (SELECT GROUP_CONCAT(p.code) FROM role_permissions rp
       JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id) AS perms
     FROM roles r ORDER BY r.id`
  ).all();
  const perms = db.prepare('SELECT code, name FROM permissions ORDER BY id').all();
  res.json({ roles, permissions: perms });
});

router.post('/', (req, res) => {
  const { username, displayName, password, role } = req.body || {};
  if (!username || !displayName || !password || !role)
    return res.status(400).json({ error: '用户名/姓名/密码/角色 必填' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: '用户名需为3-20位字母数字下划线' });
  if (String(password).length < 6)
    return res.status(400).json({ error: '密码至少6位' });

  const roleRow = db.prepare('SELECT id FROM roles WHERE code=?').get(role);
  if (!roleRow) return res.status(400).json({ error: '角色不合法' });

  const crypto = require('crypto');
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    const info = db.prepare(
      'INSERT INTO users(username,display_name,password_hash,salt,role_id) VALUES(?,?,?,?,?)'
    ).run(username, displayName, hashPassword(password, salt), salt, roleRow.id);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '用户名已存在' });
    throw e;
  }
});

router.put('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const { displayName, role, active, password } = req.body || {};
  const sets = [];
  const params = { id: user.id };

  if (displayName !== undefined) { sets.push('display_name=@displayName'); params.displayName = displayName; }
  if (active !== undefined) { sets.push('active=@active'); params.active = active ? 1 : 0; }
  if (role !== undefined) {
    const roleRow = db.prepare('SELECT id FROM roles WHERE code=?').get(role);
    if (!roleRow) return res.status(400).json({ error: '角色不合法' });
    sets.push('role_id=@roleId'); params.roleId = roleRow.id;
  }
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: '密码至少6位' });
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    sets.push('password_hash=@hash', 'salt=@salt');
    params.hash = hashPassword(password, salt); params.salt = salt;
  }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=@id`).run(params);
  res.json({ ok: true });
});


router.delete('/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: '不能删除当前登录账号' });
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
