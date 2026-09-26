-- 冷库设备档案系统 数据库结构
PRAGMA foreign_keys = ON;

-- 用户（登录账号 + 角色）
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','operator')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 设备档案
CREATE TABLE IF NOT EXISTS equipment (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,                 -- 设备编号
  name                TEXT NOT NULL,                        -- 设备名称
  temp_zone           TEXT NOT NULL CHECK (temp_zone IN ('deep_freezer','freezer','chilled','constant')),
                    -- 温区: 深冷≤-30 / 冷冻 -18~-30 / 冷藏 0~10 / 恒温
  location            TEXT NOT NULL,                        -- 安装位置
  owner               TEXT NOT NULL,                        -- 负责人
  last_maintenance    TEXT,                                 -- 最近维保日期 YYYY-MM-DD
  status              TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','standby','fault','maintenance','stopped')),
                    -- 运行状态: 运行/备用/故障/维保中/停用
  remark              TEXT,
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 设备说明书（一台设备可上传多份资料）
CREATE TABLE IF NOT EXISTS manuals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,        -- 存储文件名
  original_name TEXT NOT NULL,        -- 原始文件名
  mime_type     TEXT,
  size          INTEGER NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 操作审计日志
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  username   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_zone   ON equipment(temp_zone);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_manuals_eq       ON manuals(equipment_id);
