const crypto = require('crypto');
const { db } = require('../db');

const SECRET = process.env.APP_SECRET || 'coldstore-archive-dev-secret-change-me';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// 轻量令牌: base64url(payload).hmac  (避免额外依赖)
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch { return null; }
}

// 注入 req.user (含权限列表)
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: '未登录或登录已失效' });

  const user = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.role_id, u.active, r.code AS role_code, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
  ).get(payload.sub);
  if (!user || !user.active) return res.status(401).json({ error: '账号不可用' });

  user.permissions = db.prepare(
    `SELECT p.code FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`
  ).all(user.role_id).map(r => r.code);

  req.user = user;
  next();
}

// 要求具备权限点
function requirePerm(...codes) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const ok = codes.every(c => req.user.permissions.includes(c));
    if (!ok) return res.status(403).json({ error: '没有操作权限' });
    next();
  };
}

module.exports = { hashPassword, signToken, authenticate, requirePerm };
