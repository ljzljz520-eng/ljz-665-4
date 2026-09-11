'use strict';
require('../env'); // 先加载 .env，再读取 UPLOAD_DIR
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 允许的说明书文件类型（白名单）
const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `m_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  defParamCharset: 'utf8', // 正确解析 multipart 中的 UTF-8 中文文件名
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new Error('仅支持 PDF / Word / Excel / 图片 / TXT 格式说明书'));
  }
});

// 上传说明书：POST /api/equipment/:id/manuals  (manager 及以上)
router.post('/equipment/:id/manuals', requireRole(2), (req, res, next) => {
  const equip = db.prepare('SELECT id FROM equipment WHERE id = ?').get(req.params.id);
  if (!equip) return res.status(404).json({ error: '设备不存在' });
  upload.single('file')(req, res, (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(code).json({ error: err.message || '文件上传失败' });
    }
    if (!req.file) return res.status(400).json({ error: '未选择文件' });
    try {
      const info = db.prepare(`
        INSERT INTO manuals (equipment_id, original_name, stored_name, mime_type, size, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?)`
      ).run(equip.id, req.file.originalname, req.file.filename,
            req.file.mimetype, req.file.size, req.session.user.id);
      const row = db.prepare(`
        SELECT m.id, m.original_name, m.mime_type, m.size, m.uploaded_at,
               u.real_name AS uploaded_by_name
        FROM manuals m LEFT JOIN users u ON u.id = m.uploaded_by WHERE m.id = ?`
      ).get(info.lastInsertRowid);
      res.status(201).json({ data: row });
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      next(e);
    }
  });
});

// 下载/预览说明书：GET /api/manuals/:id/download （所有登录用户）
router.get('/manuals/:id/download', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM manuals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '文件不存在' });
  const filePath = path.join(UPLOAD_DIR, row.stored_name);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: '文件已被移除' });
  // 同时提供 ASCII fallback 与 RFC 5987 的 UTF-8 编码文件名，兼容各浏览器
  const asciiName = row.original_name.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
  res.sendFile(filePath);
});

// 删除说明书（manager 及以上），同时删除磁盘文件
router.delete('/manuals/:id', requireRole(2), (req, res) => {
  const row = db.prepare('SELECT * FROM manuals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '文件不存在' });
  db.prepare('DELETE FROM manuals WHERE id = ?').run(row.id);
  fs.unlink(path.join(UPLOAD_DIR, row.stored_name), () => {});
  res.json({ data: { ok: true } });
});

module.exports = router;
