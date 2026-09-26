// 设备说明书：上传 / 下载 / 删除
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('./db');
const { authRequired, requireRole } = require('./middleware/auth');

const router = express.Router();
router.use(authRequired);

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.jpg', '.jpeg', '.png', '.zip'];
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('不支持的文件类型，仅允许: ' + ALLOWED_EXT.join(' ')));
    }
    cb(null, true);
  },
});

function audit(req, action, target, detail) {
  db.prepare('INSERT INTO audit_log (user_id, username, action, target, detail) VALUES (?,?,?,?,?)')
    .run(req.user.id, req.user.username, action, target || null, detail ? JSON.stringify(detail) : null);
}

// POST /api/equipment/:id/manuals  登录用户（operator 起）可上传
router.post('/:id/manuals', requireRole('operator'), (req, res) => {
  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: '设备不存在' });

  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件超过 20MB 限制' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: '未收到上传文件' });
    // multer 按 latin1 解析 multipart 文件名，中文需要还原为 UTF-8
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    // 去掉路径分隔符，防止构造异常文件名
    const safeName = path.basename(originalName).replace(/[\r\n]/g, ' ').slice(0, 200) || 'manual';
    const info = db.prepare(`
      INSERT INTO manuals (equipment_id, filename, original_name, mime_type, size, uploaded_by)
      VALUES (?,?,?,?,?,?)
    `).run(eq.id, req.file.filename, safeName,
           req.file.mimetype, req.file.size, req.user.id);
    audit(req, 'manual.upload', eq.code, { name: safeName, size: req.file.size });
    res.status(201).json(db.prepare('SELECT * FROM manuals WHERE id=?').get(info.lastInsertRowid));
  });
});

// GET 下载（登录用户均可，Content-Disposition 附件方式，不暴露物理路径）
router.get('/:id/manuals/:fileId/download', (req, res) => {
  const m = db.prepare('SELECT * FROM manuals WHERE id=? AND equipment_id=?')
             .get(req.params.fileId, req.params.id);
  if (!m) return res.status(404).json({ error: '文件不存在' });
  const filePath = path.join(UPLOAD_DIR, m.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '物理文件已丢失' });
  res.download(filePath, m.original_name);
});

// DELETE 主管以上
router.delete('/:id/manuals/:fileId', requireRole('manager'), (req, res) => {
  const m = db.prepare('SELECT * FROM manuals WHERE id=? AND equipment_id=?')
             .get(req.params.fileId, req.params.id);
  if (!m) return res.status(404).json({ error: '文件不存在' });
  db.prepare('DELETE FROM manuals WHERE id=?').run(m.id);
  fs.rm(path.join(UPLOAD_DIR, m.filename), { force: true }, () => {});
  audit(req, 'manual.delete', String(m.equipment_id), { name: m.original_name });
  res.json({ ok: true });
});

module.exports = router;
