// JWT 认证与基于角色的权限控制
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'coldstore-dev-secret-change-me';
const JWT_EXPIRES = '8h';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, displayName: user.display_name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录或登录已过期' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登录令牌无效或已过期' });
  }
}

// role 至少需要满足的等级：admin > manager > operator
const LEVEL = { admin: 3, manager: 2, operator: 1 };

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if ((LEVEL[req.user.role] || 0) < LEVEL[minRole]) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

module.exports = { signToken, authRequired, requireRole, JWT_SECRET };
