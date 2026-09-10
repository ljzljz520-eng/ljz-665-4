-- 冷库设备档案系统 数据库结构 (SQLite)

PRAGMA journal_mode = WAL;

-- 用户表：三级角色 viewer(只读) / manager(设备管理员) / admin(系统管理员)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  real_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('viewer','manager','admin')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 设备档案
-- 温区 temp_zone: 速冻 / 冷冻 / 冷藏 / 恒温
-- 运行状态 status: running(运行) / stopped(停机) / maintenance(维保中) / fault(故障)
CREATE TABLE IF NOT EXISTS equipment (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  code                  TEXT NOT NULL UNIQUE,           -- 设备编号
  name                  TEXT NOT NULL,                   -- 名称
  temp_zone             TEXT NOT NULL CHECK (temp_zone IN ('速冻','冷冻','冷藏','恒温')),
  location              TEXT NOT NULL,                   -- 安装位置
  owner                 TEXT NOT NULL,                   -- 负责人
  last_maintenance_at   TEXT,                            -- 最近维保日期 YYYY-MM-DD
  status                TEXT NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','stopped','maintenance','fault')),
  remark                TEXT,                            -- 备注(选填)
  created_at            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 设备说明书(附件)，一台设备可有多份
CREATE TABLE IF NOT EXISTS manuals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id  INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  uploaded_by   INTEGER,
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by)  REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_zone   ON equipment(temp_zone);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_manuals_equip    ON manuals(equipment_id);
