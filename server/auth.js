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

const { db } = require('./db');

// 惰性预编译：模块加载时迁移可能尚未执行，首次使用时再 prepare
let getUserStmt = null;
function queryUser(id) {
  if (!getUserStmt) {
    getUserStmt = db.prepare(
      'SELECT id, username, real_name, role, active FROM users WHERE id = ?'
    );
  }
  return getUserStmt.get(id);
}

// 每次请求实时回库核对：管理员改角色/停用账号后，旧会话立即按新状态生效，
// 而不是继续信任登录时写入会话的角色快照。
function freshUser(req) {
  if (!req.session || !req.session.user) return null;
  const u = queryUser(req.session.user.id);
  if (!u || !u.active) return null;
  // 用数据库最新值刷新会话快照（角色/姓名可能刚被管理员修改）
  req.session.user = { id: u.id, username: u.username, realName: u.real_name, role: u.role };
  return req.session.user;
}

function denyInvalidSession(req, res) {
  if (req.session && req.session.user) req.session.destroy(() => {});
  return res.status(401).json({ error: '未登录或会话已过期' });
}

function requireAuth(req, res, next) {
  if (!freshUser(req)) return denyInvalidSession(req, res);
  next();
}

function requireRole(level) {
  return (req, res, next) => {
    const user = freshUser(req);
    if (!user) return denyInvalidSession(req, res);
    if (!(ROLE_LEVEL[user.role] >= level)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, requireAuth, requireRole, ROLE_LEVEL };
