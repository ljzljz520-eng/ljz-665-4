// 设备档案 CRUD + 温区/状态筛选
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./middleware/auth');

const router = express.Router();
router.use(authRequired);

const ZONES = ['deep_freezer', 'freezer', 'chilled', 'constant'];
const STATUSES = ['running', 'standby', 'fault', 'maintenance', 'stopped'];

function audit(req, action, target, detail) {
  db.prepare('INSERT INTO audit_log (user_id, username, action, target, detail) VALUES (?,?,?,?,?)')
    .run(req.user.id, req.user.username, action, target || null, detail ? JSON.stringify(detail) : null);
}

// 从请求体构造并校验设备字段，返回 { data, errors }
function parseEquipment(body, { partial = false } = {}) {
  const fields = ['code', 'name', 'temp_zone', 'location', 'owner', 'last_maintenance', 'status', 'remark'];
  const data = {};
  const errors = [];

  for (const f of fields) {
    if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? body[f].trim() : body[f];
  }
  if (!partial) {
    for (const f of ['code', 'name', 'temp_zone', 'location', 'owner', 'status']) {
      if (data[f] === undefined || data[f] === '') errors.push(`缺少必填字段: ${f}`);
    }
  }
  if (data.temp_zone !== undefined && !ZONES.includes(data.temp_zone)) errors.push('温区取值非法');
  if (data.status !== undefined && !STATUSES.includes(data.status)) errors.push('运行状态取值非法');
  if (data.last_maintenance !== null && data.last_maintenance !== undefined && data.last_maintenance !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.last_maintenance)) {
      errors.push('最近维保日期格式应为 YYYY-MM-DD');
    } else if (isNaN(Date.parse(data.last_maintenance))) {
      errors.push('最近维保日期不是有效日期');
    }
  }
  if (data.code !== undefined && !/^[A-Za-z0-9_-]{2,30}$/.test(data.code)) {
    errors.push('设备编号需为 2~30 位字母、数字、- 或 _');
  }
  return { data, errors };
}

// GET /api/equipment?temp_zone=&status=&keyword=&page=&pageSize=
router.get('/', (req, res) => {
  const { temp_zone, status, keyword } = req.query;
  const where = [];
  const params = {};

  if (temp_zone) {
    if (!ZONES.includes(temp_zone)) return res.status(400).json({ error: '温区筛选值非法' });
    where.push('temp_zone = @temp_zone'); params.temp_zone = temp_zone;
  }
  if (status) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: '状态筛选值非法' });
    where.push('status = @status'); params.status = status;
  }
  if (keyword) {
    where.push('(code LIKE @kw OR name LIKE @kw OR location LIKE @kw OR owner LIKE @kw)');
    params.kw = `%${keyword}%`;
  }
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM equipment ${whereSql}`).get(params).c;
  const list = db.prepare(`
    SELECT * FROM equipment ${whereSql}
    ORDER BY id DESC LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

  res.json({ total, page, pageSize, list });
});

router.get('/meta', (req, res) => {
  res.json({ tempZones: ZONES, statuses: STATUSES });
});

// GET /api/equipment/:id 详情（含说明书列表）
router.get('/:id', (req, res) => {
  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: '设备不存在' });
  eq.manuals = db.prepare(`
    SELECT m.id, m.original_name, m.mime_type, m.size, m.uploaded_at,
           u.display_name AS uploaded_by_name
    FROM manuals m LEFT JOIN users u ON u.id = m.uploaded_by
    WHERE m.equipment_id=? ORDER BY m.id DESC
  `).all(req.params.id);
  res.json(eq);
});

// POST  主管以上
router.post('/', requireRole('manager'), (req, res) => {
  const { data, errors } = parseEquipment(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('；') });
  try {
    const info = db.prepare(`
      INSERT INTO equipment (code,name,temp_zone,location,owner,last_maintenance,status,remark,created_by)
      VALUES (@code,@name,@temp_zone,@location,@owner,@last_maintenance,@status,@remark,@created_by)
    `).run({
      code: data.code, name: data.name, temp_zone: data.temp_zone, location: data.location,
      owner: data.owner, last_maintenance: data.last_maintenance || null, status: data.status,
      remark: data.remark || null, created_by: req.user.id,
    });
    audit(req, 'equipment.create', data.code, { id: info.lastInsertRowid });
    res.status(201).json(db.prepare('SELECT * FROM equipment WHERE id=?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '设备编号已存在' });
    throw e;
  }
});

// PUT  主管以上
router.put('/:id', requireRole('manager'), (req, res) => {
  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: '设备不存在' });
  const { data, errors } = parseEquipment(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('；') });

  const merged = {
    code: data.code ?? eq.code, name: data.name ?? eq.name,
    temp_zone: data.temp_zone ?? eq.temp_zone, location: data.location ?? eq.location,
    owner: data.owner ?? eq.owner,
    last_maintenance: data.last_maintenance === '' ? null : (data.last_maintenance ?? eq.last_maintenance),
    status: data.status ?? eq.status, remark: data.remark ?? eq.remark,
    id: eq.id,
  };
  try {
    db.prepare(`
      UPDATE equipment SET
        code=@code, name=@name, temp_zone=@temp_zone, location=@location, owner=@owner,
        last_maintenance=@last_maintenance, status=@status, remark=@remark,
        updated_at=datetime('now','localtime')
      WHERE id=@id
    `).run(merged);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '设备编号已存在' });
    throw e;
  }
  audit(req, 'equipment.update', merged.code, data);
  res.json(db.prepare('SELECT * FROM equipment WHERE id=?').get(eq.id));
});

// DELETE 仅管理员
router.delete('/:id', requireRole('admin'), (req, res) => {
  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: '设备不存在' });
  db.prepare('DELETE FROM equipment WHERE id=?').run(eq.id);
  audit(req, 'equipment.delete', eq.code, { name: eq.name });
  res.json({ ok: true });
});

module.exports = router;
