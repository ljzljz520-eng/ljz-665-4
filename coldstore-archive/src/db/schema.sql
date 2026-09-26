-- ============================================================
-- 冷库设备档案 - 数据库结构 (SQLite)
-- ============================================================

PRAGMA foreign_keys = ON;

-- 角色
CREATE TABLE IF NOT EXISTS roles (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,   -- admin / manager / viewer
  name  TEXT NOT NULL
);

-- 权限点
CREATE TABLE IF NOT EXISTS permissions (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

-- 角色-权限
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 用户
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 菜单 (permission_code 决定可见性)
CREATE TABLE IF NOT EXISTS menus (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  path            TEXT NOT NULL,
  icon            TEXT NOT NULL DEFAULT '',
  sort_no         INTEGER NOT NULL DEFAULT 0,
  permission_code TEXT NOT NULL
);

-- 温区字典
CREATE TABLE IF NOT EXISTS temp_zones (
  code       TEXT PRIMARY KEY,  -- H/M/L/U/RT
  name       TEXT NOT NULL,
  temp_range TEXT NOT NULL,
  sort_no    INTEGER NOT NULL DEFAULT 0
);

-- 运行状态字典
CREATE TABLE IF NOT EXISTS status_dict (
  code    TEXT PRIMARY KEY,  -- running/standby/fault/maintenance/decommissioned
  name    TEXT NOT NULL,
  sort_no INTEGER NOT NULL DEFAULT 0
);

-- 设备档案
CREATE TABLE IF NOT EXISTS equipment (
  id                     INTEGER PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,           -- 设备编号
  name                   TEXT NOT NULL,                  -- 设备名称
  zone_code              TEXT NOT NULL REFERENCES temp_zones(code),
  location               TEXT NOT NULL,                  -- 安装位置
  owner                  TEXT NOT NULL,                  -- 负责人
  last_maintenance_date  TEXT,                           -- 最近维保日期 YYYY-MM-DD
  status                 TEXT NOT NULL DEFAULT 'running'
                              REFERENCES status_dict(code),
  remark                 TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_zone   ON equipment(zone_code);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_owner  ON equipment(owner);

-- 设备说明书 / 附件
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_documents_equipment ON documents(equipment_id);

-- updated_at 自动刷新
CREATE TRIGGER IF NOT EXISTS trg_equipment_updated
AFTER UPDATE ON equipment
FOR EACH ROW
BEGIN
  UPDATE equipment SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;
