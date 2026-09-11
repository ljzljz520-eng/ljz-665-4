'use strict';
// 简易 .env 加载（零额外依赖）
// 规则：已存在的环境变量优先，.env 仅用于补缺；模块加载时自动执行一次，
// 保证所有入口（server/index.js、scripts/migrate.js、scripts/seed.js 等）行为一致。
const path = require('path');
const fs = require('fs');

function loadEnv(envPath) {
  const p = envPath || path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadEnv();

module.exports = { loadEnv };
