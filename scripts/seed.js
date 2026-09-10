'use strict';
const { db, migrate } = require('../server/db');
const { hashPassword } = require('../server/auth');

migrate();

const users = [
  { username: 'admin',   password: 'admin123',  real_name: '系统管理员', role: 'admin' },
  { username: 'manager', password: 'manager123', real_name: '王维保',    role: 'manager' },
  { username: 'viewer',  password: 'viewer123',  real_name: '李巡查',    role: 'viewer' }
];

const insUser = db.prepare(
  'INSERT OR IGNORE INTO users (username, password_hash, real_name, role) VALUES (?, ?, ?, ?)'
);
for (const u of users) insUser.run(u.username, hashPassword(u.password), u.real_name, u.role);

const equipCount = db.prepare('SELECT COUNT(*) AS c FROM equipment').get().c;
if (equipCount === 0) {
  const ins = db.prepare(`
    INSERT INTO equipment (code, name, temp_zone, location, owner, last_maintenance_at, status, remark)
    VALUES (@code, @name, @temp_zone, @location, @owner, @lma, @status, @remark)`);
  const data = [
    ['LK-DJ-001', '螺杆式制冷机组1号', '速冻', '制冷机房A区', '王维保', '2026-08-20', 'running', '比泽尔压缩机'],
    ['LK-DJ-002', '螺杆式制冷机组2号', '冷冻', '制冷机房A区', '王维保', '2026-07-30', 'maintenance', '季度维保中'],
    ['LK-LK-010', '冷藏库冷风机10',   '冷藏', '2号库东侧',   '赵冷链', '2026-08-05', 'running', null],
    ['LK-HW-007', '恒温恒湿一体机7',  '恒温', '质检恒温间',   '陈工',   '2026-06-18', 'fault', '湿度传感器报故障'],
    ['LK-DJ-003', '活塞式制冷机组3号', '冷冻', '制冷机房B区', '王维保', '2026-09-01', 'stopped', '备用机组'],
    ['LK-LK-011', '冷藏库冷风机11',   '冷藏', '2号库西侧',   '赵冷链', null,           'running', null]
  ];
  for (const [code, name, temp_zone, location, owner, lma, status, remark] of data) {
    ins.run({ code, name, temp_zone, location, owner, lma, status, remark });
  }
  console.log(`✓ 已写入 ${data.length} 条示例设备`);
} else {
  console.log('设备数据已存在，跳过示例数据');
}

console.log('✓ 种子数据完成');
console.log('  默认账号: admin/admin123, manager/manager123, viewer/viewer123');
process.exit(0);
