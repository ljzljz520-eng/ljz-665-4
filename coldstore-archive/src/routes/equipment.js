const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('../db');
const { authenticate, requirePerm } = require('../middleware/auth');

const router = express.Router();

// ---------- 上传配置 ----------
const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg']);
const MAX_MB = 20;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `eq${req.params.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(ALLOWED_EXT.has(ext) ? null : new Error('仅支持 pdf/doc/docx/png/jpg 格式'), ALLOWED_EXT.has(ext));
  },
});

// ---------- 校验 ----------
const ZONES = new Set(db.prepare('SELECT code FROM temp_zones').all().map(z => z.code));
const STATUSES = new Set(db.prepare('SELECT code FROM status_dict').all().map(s => s.code));

function validate(body, { partial = false } = {}) {
  const errors = [];
  const out = {};
  const str = v => (v == null ? '' : String(v).trim());

  if (!partial || 'code' in body) {
    out.code = str(body.code);
    if (!out.code) errors.push('设备编号必填');
    else if (!/^[A-Za-z0-9_-]{2,30}$/.test(out.code)) errors.push('编号只能含字母数字-_，长度2-30');
  }
  if (!partial || 'name' in body) {
    out.name = str(body.name);
    if (!out.name) errors.push('设备名称必填');
    else if (out.name.length > 60) errors.push('名称最长60字');
  }
  if (!partial || 'zone_code' in body) {
    out.zone_code = str(body.zone_code);
    if (!ZONES.has(out.zone_code)) errors.push('温区不合法');
  }
  if (!partial || 'location' in body) {
    out.location = str(body.location);
    if (!out.location) errors.push('安装位置必填');
  }
  if (!partial || 'owner' in body) {
    out.owner = str(body.owner);
    if (!out.owner) errors.push('负责人必填');
  }
  if (!partial || 'last_maintenance_date' in body) {
    const d = str(body.last_maintenance_date);
    out.last_maintenance_date = d || null;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push('维保日期格式应为 YYYY-MM-DD');
  }
  if (!partial || 'status' in body) {
    out.status = str(body.status) || 'running';
    if (!STATUSES.has(out.status)) errors.push('运行状态不合法');
  }
  if ('remark' in body) out.remark = str(body.remark).slice(0, 500) || null;
  return { errors, out };
}

// ---------- 设备列表 (按温区/状态/关键字筛选) ----------
router.get('/', authenticate, requirePerm('equipment:read'), (req, res) => {
  const { zone, status, q } = req.query;
  const where = [];
  const params = {};
  if (zone && ZONES.has(zone)) { where.push('e.zone_code = @zone'); params.zone = zone; }
  if (status && STATUSES.has(status)) { where.push('e.status = @status'); params.status = status; }
  if (q) {
    where.push('(e.code LIKE @kw OR e.name LIKE @kw OR e.location LIKE @kw OR e.owner LIKE @kw)');
    params.kw = `%${String(q).trim()}%`;
  }
  const sql = `
    SELECT e.*, z.name AS zone_name, z.temp_range, s.name AS status_name,
      (SELECT COUNT(*) FROM documents d WHERE d.equipment_id = e.id) AS doc_count
    FROM equipment e
    JOIN temp_zones z ON z.code = e.zone_code
    JOIN status_dict s ON s.code = e.status
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.code`;
  const rows = db.prepare(sql).all(params);
  res.json({ total: rows.length, items: rows });
});

// ---------- 看板统计 ----------
router.get('/stats/summary', authenticate, requirePerm('equipment:read'), (_req, res) => {
  const byZone = db.prepare(
    `SELECT z.code, z.name, COUNT(e.id) AS n FROM temp_zones z
     LEFT JOIN equipment e ON e.zone_code = z.code GROUP BY z.code ORDER BY z.sort_no`
  ).all();
  const byStatus = db.prepare(
    `SELECT s.code, s.name, COUNT(e.id) AS n FROM status_dict s
     LEFT JOIN equipment e ON e.status = s.code GROUP BY s.code ORDER BY s.sort_no`
  ).all();
  const overdue = db.prepare(
    `SELECT COUNT(*) AS n FROM equipment
     WHERE last_maintenance_date IS NULL OR last_maintenance_date < date('now','-90 day')`
  ).get().n;
  res.json({ total: db.prepare('SELECT COUNT(*) AS n FROM equipment').get().n, byZone, byStatus, overdue });
});

// ---------- 详情 ----------
router.get('/:id', authenticate, requirePerm('equipment:read'), (req, res) => {
  const row = db.prepare(
    `SELECT e.*, z.name AS zone_name, z.temp_range, s.name AS status_name
     FROM equipment e JOIN temp_zones z ON z.code=e.zone_code
     JOIN status_dict s ON s.code=e.status WHERE e.id=?`
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: '设备不存在' });
  row.documents = db.prepare(
    `SELECT d.id, d.original_name, d.mime_type, d.size_bytes, d.uploaded_at,
            u.display_name AS uploaded_by_name
     FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by
     WHERE d.equipment_id=? ORDER BY d.uploaded_at DESC`
  ).get(row.id);
  res.json(row);
});

// ---------- 新增 ----------
router.post('/', authenticate, requirePerm('equipment:write'), (req, res) => {
  const { errors, out } = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('；') });
  try {
    const info = db.prepare(
      `INSERT INTO equipment(code,name,zone_code,location,owner,last_maintenance_date,status,remark)
       VALUES(@code,@name,@zone_code,@location,@owner,@last_maintenance_date,@status,COALESCE(@remark,NULL))`
    ).run({ ...out, remark: out.remark ?? null });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '设备编号已存在' });
    throw e;
  }
});

// ---------- 修改 ----------
router.put('/:id', authenticate, requirePerm('equipment:write'), (req, res) => {
  const exists = db.prepare('SELECT id FROM equipment WHERE id=?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: '设备不存在' });
  const { errors, out } = validate(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('；') });

  const cols = Object.keys(out);
  if (!cols.length) return res.json({ ok: true });
  const dup = db.prepare('SELECT id FROM equipment WHERE code=? AND id<>?').get(out.code || '', req.params.id);
  if (dup) return res.status(409).json({ error: '设备编号已存在' });

  db.prepare(`UPDATE equipment SET ${cols.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`)
    .run({ ...out, id: req.params.id });
  res.json({ ok: true });
});

// ---------- 删除 ----------
router.delete('/:id', authenticate, requirePerm('equipment:delete'), (req, res) => {
  const docs = db.prepare('SELECT stored_name FROM documents WHERE equipment_id=?').all(req.params.id);
  const info = db.prepare('DELETE FROM equipment WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: '设备不存在' });
  for (const d of docs) {
    fs.promises.unlink(path.join(UPLOAD_DIR, d.stored_name)).catch(() => {});
  }
  res.json({ ok: true });
});

// ---------- 上传说明书 ----------
router.post('/:id/documents', authenticate, requirePerm('document:upload'),
  (req, res, next) => {
    const eq = db.prepare('SELECT id FROM equipment WHERE id=?').get(req.params.id);
    if (!eq) return res.status(404).json({ error: '设备不存在' });
    next();
  },
  upload.single('file'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const info = db.prepare(
      `INSERT INTO documents(equipment_id,original_name,stored_name,mime_type,size_bytes,uploaded_by)
       VALUES(?,?,?,?,?,?)`
    ).run(req.params.id, req.file.originalname, req.file.filename,
          req.file.mimetype, req.file.size, req.user.id);
    res.status(201).json({ id: info.lastInsertRowid, original_name: req.file.originalname });
  }
);

// ---------- 下载说明书 ----------
router.get('/:id/documents/:docId/download', authenticate, requirePerm('equipment:read'),
  (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id=? AND equipment_id=?')
      .get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).json({ error: '文件不存在' });
    const fp = path.join(UPLOAD_DIR, doc.stored_name);
    if (!fs.existsSync(fp)) return res.status(410).json({ error: '物理文件已丢失' });
    res.download(fp, doc.original_name);
  }
);

// ---------- 删除说明书 ----------
router.delete('/:id/documents/:docId', authenticate, requirePerm('document:delete'),
  (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id=? AND equipment_id=?')
      .get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).json({ error: '文件不存在' });
    db.prepare('DELETE FROM documents WHERE id=?').run(doc.id);
    fs.promises.unlink(path.join(UPLOAD_DIR, doc.stored_name)).catch(() => {});
    res.json({ ok: true });
  }
);

module.exports = router;
