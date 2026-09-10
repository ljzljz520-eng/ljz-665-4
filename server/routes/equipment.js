'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

const ZONES = ['速冻', '冷冻', '冷藏', '恒温'];
const STATUSES = ['running', 'stopped', 'maintenance', 'fault'];

// 列表：支持 temp_zone 与 status 筛选（viewer 及以上可查）
router.get('/', requireAuth, (req, res) => {
  const { temp_zone, status, keyword } = req.query;
  const where = [];
  const params = {};

  if (temp_zone) {
    if (!ZONES.includes(temp_zone)) return res.status(400).json({ error: '非法的温区参数' });
    where.push('temp_zone = @temp_zone');
    params.temp_zone = temp_zone;
  }
  if (status) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: '非法的状态参数' });
    where.push('status = @status');
    params.status = status;
  }
  if (keyword) {
    where.push('(code LIKE @kw OR name LIKE @kw OR location LIKE @kw OR owner LIKE @kw)');
    params.kw = `%${keyword}%`;
  }

  const sql = `
    SELECT id, code, name, temp_zone, location, owner,
           last_maintenance_at, status, remark, created_at, updated_at
    FROM equipment
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC`;
  const rows = db.prepare(sql).all(params);
  res.json({ data: rows });
});

// 筛选项字典
router.get('/meta', requireAuth, (_req, res) => {
  res.json({ data: {
    zones: ZONES,
    statuses: [
      { value: 'running', label: '运行' },
      { value: 'stopped', label: '停机' },
      { value: 'maintenance', label: '维保中' },
      { value: 'fault', label: '故障' }
    ]
  }});
});

// 详情（含说明书列表）
router.get('/:id', requireAuth, (req, res) => {
  const equip = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!equip) return res.status(404).json({ error: '设备不存在' });
  equip.manuals = db.prepare(`
    SELECT m.id, m.original_name, m.mime_type, m.size, m.uploaded_at,
           u.real_name AS uploaded_by_name
    FROM manuals m LEFT JOIN users u ON u.id = m.uploaded_by
    WHERE m.equipment_id = ? ORDER BY m.id DESC`).all(equip.id);
  res.json({ data: equip });
});

function validateBody(body) {
  const b = body || {};
  for (const f of ['code', 'name', 'temp_zone', 'location', 'owner', 'status']) {
    if (b[f] === undefined || b[f] === null || String(b[f]).trim() === '') {
      return `字段 ${f} 不能为空`;
    }
  }
  if (!ZONES.includes(b.temp_zone)) return '温区取值非法';
  if (!STATUSES.includes(b.status)) return '状态取值非法';
  if (b.last_maintenance_at && !/^\d{4}-\d{2}-\d{2}$/.test(b.last_maintenance_at)) {
    return '维保日期格式应为 YYYY-MM-DD';
  }
  return null;
}

// 新建（manager 及以上）
router.post('/', requireRole(2), (req, res) => {
  const err = validateBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  try {
    const info = db.prepare(`
      INSERT INTO equipment (code, name, temp_zone, location, owner, last_maintenance_at, status, remark)
      VALUES (@code, @name, @temp_zone, @location, @owner, @last_maintenance_at, @status, @remark)`
    ).run({
      code: b.code.trim(), name: b.name.trim(), temp_zone: b.temp_zone,
      location: b.location.trim(), owner: b.owner.trim(),
      last_maintenance_at: b.last_maintenance_at || null,
      status: b.status, remark: b.remark || null
    });
    res.status(201).json({ data: db.prepare('SELECT * FROM equipment WHERE id = ?').get(info.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '设备编号已存在' });
    throw e;
  }
});

// 更新
router.put('/:id', requireRole(2), (req, res) => {
  const equip = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!equip) return res.status(404).json({ error: '设备不存在' });
  const err = validateBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  try {
    db.prepare(`
      UPDATE equipment SET code=@code, name=@name, temp_zone=@temp_zone, location=@location,
        owner=@owner, last_maintenance_at=@lma, status=@status, remark=@remark,
        updated_at=datetime('now','localtime')
      WHERE id=@id`
    ).run({
      id: equip.id, code: b.code.trim(), name: b.name.trim(), temp_zone: b.temp_zone,
      location: b.location.trim(), owner: b.owner.trim(),
      lma: b.last_maintenance_at || null, status: b.status, remark: b.remark || null
    });
    res.json({ data: db.prepare('SELECT * FROM equipment WHERE id = ?').get(equip.id) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '设备编号已存在' });
    throw e;
  }
});

// 删除
router.delete('/:id', requireRole(2), (req, res) => {
  const equip = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!equip) return res.status(404).json({ error: '设备不存在' });
  db.prepare('DELETE FROM equipment WHERE id = ?').run(equip.id);
  res.json({ data: { ok: true } });
});

module.exports = router;
