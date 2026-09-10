'use strict';
const { migrate } = require('../server/db');
migrate();
console.log('✓ 数据库迁移完成 (data/coldstore.db)');
process.exit(0);
