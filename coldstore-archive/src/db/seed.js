const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

module.exports = function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM roles').get().n;
  if (count > 0) return;

  const tx = db.transaction(() => {
    // ---- 角色 ----
    const insRole = db.prepare('INSERT INTO roles(code,name) VALUES(?,?)');
    insRole.run('admin', '管理员');
    insRole.run('manager', '设备主管');
    insRole.run('viewer', '只读用户');
    const roleId = Object.fromEntries(
      db.prepare('SELECT id, code FROM roles').all().map(r => [r.code, r.id])
    );

    // ---- 权限点 ----
    const perms = [
      ['equipment:read',   '查看设备档案'],
      ['equipment:write',  '编辑设备档案'],
      ['equipment:delete', '删除设备档案'],
      ['document:upload',  '上传说明书'],
      ['document:delete',  '删除说明书'],
      ['user:manage',      '用户与权限管理'],
      ['menu:dashboard',   '看板菜单'],
      ['menu:equipment',   '设备档案菜单'],
      ['menu:users',       '用户管理菜单'],
    ];
    const insPerm = db.prepare('INSERT INTO permissions(code,name) VALUES(?,?)');
    const permId = {};
    for (const [code, name] of perms) {
      insPerm.run(code, name);
      permId[code] = db.prepare('SELECT id FROM permissions WHERE code=?').get(code).id;
    }

    // ---- 角色授权 ----
    const grant = db.prepare(
      'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)'
    );
    const grants = {
      admin:   perms.map(([c]) => c),
      manager: ['menu:dashboard','menu:equipment','equipment:read','equipment:write','document:upload','document:delete'],
      viewer:  ['menu:dashboard','menu:equipment','equipment:read'],
    };
    for (const [role, codes] of Object.entries(grants)) {
      for (const code of codes) grant.run(roleId[role], permId[code]);
    }

    // ---- 用户（初始密码见 README）----
    const insUser = db.prepare(
      'INSERT INTO users(username,display_name,password_hash,salt,role_id) VALUES(?,?,?,?,?)'
    );
    const users = [
      ['admin',   '系统管理员', 'Admin@123', 'admin'],
      ['manager', '冷库主管王伟', 'Manager@123', 'manager'],
      ['viewer',  '值班员小李', 'Viewer@123', 'viewer'],
    ];
    for (const [username, displayName, pwd, role] of users) {
      const { hash, salt } = hashPassword(pwd);
      insUser.run(username, displayName, hash, salt, roleId[role]);
    }

    // ---- 菜单 ----
    const insMenu = db.prepare(
      'INSERT INTO menus(code,name,path,icon,sort_no,permission_code) VALUES(?,?,?,?,?,?)'
    );
    insMenu.run('dashboard', '运行看板', '#/dashboard', '📊', 10, 'menu:dashboard');
    insMenu.run('equipment', '设备档案', '#/equipment', '🧊', 20, 'menu:equipment');
    insMenu.run('users',     '用户与权限', '#/users', '👤', 30, 'menu:users');

    // ---- 温区字典 ----
    const insZone = db.prepare(
      'INSERT INTO temp_zones(code,name,temp_range,sort_no) VALUES(?,?,?,?)'
    );
    [
      ['H',  '高温冷藏区', '+2℃ ~ +10℃',   10],
      ['M',  '中温冷藏区', '-2℃ ~ +2℃',    20],
      ['L',  '低温冷冻区', '-25℃ ~ -15℃',  30],
      ['U',  '超低温区',   '≤ -40℃',       40],
      ['RT', '常温穿堂区', '+10℃ ~ +25℃',  50],
    ].forEach(z => insZone.run(...z));

    // ---- 状态字典 ----
    const insStatus = db.prepare(
      'INSERT INTO status_dict(code,name,sort_no) VALUES(?,?,?)'
    );
    [
      ['running',       '运行中', 10],
      ['standby',       '备用',   20],
      ['fault',         '故障',   30],
      ['maintenance',   '维保中', 40],
      ['decommissioned','停用',   50],
    ].forEach(s => insStatus.run(...s));

    // ---- 示例设备 ----
    const insEq = db.prepare(
      `INSERT INTO equipment(code,name,zone_code,location,owner,last_maintenance_date,status,remark)
       VALUES(?,?,?,?,?,?,?,?)`
    );
    [
      ['CS-H-001', '1#高温库螺杆机组', 'H', '高温库东侧机房', '王伟', '2026-08-15', 'running',     '比泽尔 CSH-75'],
      ['CS-L-002', '2#低温库活塞机组', 'L', '低温库西侧机房', '张磊', '2026-07-30', 'maintenance', '换油保养中'],
      ['CS-L-003', '3#速冻隧道压缩机', 'L', '速冻车间地下一层', '张磊', '2026-09-02', 'running', ''],
      ['CS-U-004', '金枪鱼超低温库机组', 'U', '超低温库独立机房', '刘洋', '2026-06-18', 'fault',       '高压报警待检修'],
      ['CS-M-005', '保鲜库风冷冷凝器', 'M', '屋顶设备平台A区', '王伟', '2026-09-10', 'running', ''],
      ['CS-RT-006', '穿堂区冷风机', 'RT', '1层分拣穿堂', '刘洋', null, 'standby', ''],
    ].forEach(e => insEq.run(...e));
  });
  tx();
  console.log('[seed] 初始数据已写入 (admin/Admin@123, manager/Manager@123, viewer/Viewer@123)');
};
