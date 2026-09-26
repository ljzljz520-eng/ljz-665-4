// 初始化数据库：建表 + 种子账号/示例设备
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const upsertUser = db.prepare(`
  INSERT INTO users (username, password_hash, display_name, role)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(username) DO NOTHING
`);

// 三个角色账号（部署后请修改默认密码）
const accounts = [
  ['admin',    'admin123',    '系统管理员', 'admin'],
  ['manager',  'manager123',  '设备主管',   'manager'],
  ['operator', 'operator123', '运维员',     'operator'],
];
for (const [u, p, name, role] of accounts) {
  upsertUser.run(u, bcrypt.hashSync(p, 10), name, role);
}

const count = db.prepare('SELECT COUNT(*) c FROM equipment').get().c;
if (count === 0) {
  const admin = db.prepare('SELECT id FROM users WHERE username=?').get('admin').id;
  const insert = db.prepare(`
    INSERT INTO equipment (code, name, temp_zone, location, owner, last_maintenance, status, remark, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const samples = [
    ['LK-D01', '低温螺杆式冷凝机组', 'deep_freezer', '1号冷库机房-东侧', '张伟', '2026-08-15', 'running',   '深冷库主用机组'],
    ['LK-D02', '速冻隧道风机组',     'deep_freezer', '2号速冻车间顶部', '李娜', '2026-07-30', 'fault',     '蒸发器结霜异常，待检修'],
    ['LK-F01', '冷库冷风机（冷冻）', 'freezer',      '3号冷冻库内-北侧', '王强', '2026-09-02', 'running',   null],
    ['LK-F02', '并联制冷压缩机组',   'freezer',      '1号冷库机房-西侧', '张伟', '2026-09-10', 'maintenance', '季度保养中'],
    ['LK-C01', '冷藏库冷风机',       'chilled',      '4号冷藏库-西南角', '赵敏', '2026-08-28', 'running',   null],
    ['LK-C02', '果蔬保鲜库机组',     'chilled',      '5号保鲜库机房',     '刘洋', '2026-06-20', 'standby',   '旺季备用'],
    ['LK-T01', '恒温库精密空调',     'constant',     '6号恒温恒湿库',     '陈晨', '2026-09-18', 'running',   '15~25℃ 药品区'],
    ['LK-T02', '旧版风冷模块机',     'constant',     '旧库区',             '王强', null,         'stopped',   '已列入报废计划'],
  ];
  const tx = db.transaction(() => {
    for (const s of samples) insert.run(...s, admin);
  });
  tx();
  console.log(`已写入 ${samples.length} 条示例设备`);
}

console.log('数据库初始化完成');
console.log('默认账号: admin/admin123, manager/manager123, operator/operator123');
process.exit(0);
