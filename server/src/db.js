// 数据库连接（better-sqlite3，同步 API）
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'coldstore.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
