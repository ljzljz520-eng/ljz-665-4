'use strict';
const crypto = require('crypto');

// 基于 Node 内置 scrypt 的密码哈希，无外部依赖
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// 角色等级，数字越大权限越高
const ROLE_LEVEL = { viewer: 1, manager: 2, admin: 3 };

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  next();
}

function requireRole(level) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: '未登录或会话已过期' });
    }
    if (ROLE_LEVEL[req.session.user.role] < level) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, requireAuth, requireRole, ROLE_LEVEL };
