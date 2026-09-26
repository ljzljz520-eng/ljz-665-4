const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'coldstore.db'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// 首次启动：建表 + 种子数据
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
require('./seed')(db);

module.exports = { db, UPLOAD_DIR };
