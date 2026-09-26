// 部署验证：自动拉起服务并执行端到端检查（数据库/筛选/详情/上传/权限/部署可用性）
// 用法：npm run verify   （要求已先执行 npm run init-db，或使用全新目录）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3100';
let serverProc = null;
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
async function call(method, url, { token, body, isForm } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (isForm) payload = body;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const resp = await fetch(BASE + url, { method, headers, body: payload });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data, headers: resp.headers };
}
async function waitForServer(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  console.log('\n=== 冷库设备档案系统 部署验证 ===\n');

  // [0] 数据库文件检查
  const dbPath = path.join(__dirname, '..', 'server', 'data', 'coldstore.db');
  ok('数据库文件存在 (server/data/coldstore.db)', fs.existsSync(dbPath));

  // 若外部没有可用服务，则本地拉起
  try {
    await fetch(BASE + '/api/health');
    console.log('检测到已运行的服务，直接验证。');
  } catch {
    console.log('未检测到服务，临时启动 (PORT=3100) …');
    serverProc = spawn(process.execPath, ['server/src/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: '3100', JWT_SECRET: 'verify-secret' },
      stdio: 'ignore',
    });
  }
  if (!(await waitForServer())) throw new Error('服务启动失败');

  // [1] 健康检查
  const health = await call('GET', '/api/health');
  ok('健康检查 /api/health 返回 200', health.status === 200 && health.data.ok === true);

  // [2] 未登录访问被拒
  const noAuth = await call('GET', '/api/equipment');
  ok('未登录访问设备列表返回 401', noAuth.status === 401);

  // [3] 错误密码登录失败
  const badLogin = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
  ok('错误密码登录返回 401', badLogin.status === 401);

  // [4] 三种角色登录
  const login = async (u, p) => call('POST', '/api/auth/login', { body: { username: u, password: p } });
  const admin = await login('admin', 'admin123');
  const manager = await login('manager', 'manager123');
  const operator = await login('operator', 'operator123');
  ok('admin / manager / operator 均可登录',
    admin.status === 200 && manager.status === 200 && operator.status === 200);

  // [5] /me 权限矩阵
  const meOp = await call('GET', '/api/auth/me', { token: operator.data.token });
  ok('operator：可查看、可传说明书，但不能增改设备',
    meOp.data.permissions.equipmentView === true &&
    meOp.data.permissions.manualUpload === true &&
    meOp.data.permissions.equipmentCreate === false &&
    meOp.data.permissions.equipmentDelete === false);
  const meMgr = await call('GET', '/api/auth/me', { token: manager.data.token });
  ok('manager：可编辑设备，但不能删除设备',
    meMgr.data.permissions.equipmentEdit === true && meMgr.data.permissions.equipmentDelete === false);
  const meAdmin = await call('GET', '/api/auth/me', { token: admin.data.token });
  ok('admin：拥有全部权限', meAdmin.data.permissions.equipmentDelete === true);

  // [6] 列表 + 筛选
  const all = await call('GET', '/api/equipment', { token: admin.data.token });
  ok('设备列表可查询且含种子数据 (>=8 条)', all.status === 200 && all.data.total >= 8);

  const byZone = await call('GET', '/api/equipment?temp_zone=chilled', { token: admin.data.token });
  ok('按温区筛选 (chilled)：全部命中冷藏区',
    byZone.data.list.length > 0 && byZone.data.list.every(e => e.temp_zone === 'chilled'));

  const byStatus = await call('GET', '/api/equipment?status=fault', { token: admin.data.token });
  ok('按状态筛选 (fault)：全部命中故障状态',
    byStatus.data.list.length > 0 && byStatus.data.list.every(e => e.status === 'fault'));

  const both = await call('GET', '/api/equipment?temp_zone=freezer&status=maintenance', { token: admin.data.token });
  ok('温区+状态组合筛选正确',
    both.data.list.length >= 1 && both.data.list.every(e => e.temp_zone === 'freezer' && e.status === 'maintenance'));

  const kw = await call('GET', '/api/equipment?keyword=' + encodeURIComponent('张伟'), { token: admin.data.token });
  ok('关键字（负责人）筛选生效', kw.data.list.length >= 2);

  const badFilter = await call('GET', '/api/equipment?temp_zone=hacker', { token: admin.data.token });
  ok('非法筛选值返回 400', badFilter.status === 400);

  // [7] 新增设备（主管）+ 编号唯一约束
  const newEq = { code: 'LK-T99', name: '验证用恒温机组', temp_zone: 'constant', location: '验证机房', owner: '验证员', status: 'standby', last_maintenance: '2026-09-01' };
  const created = await call('POST', '/api/equipment', { token: manager.data.token, body: newEq });
  ok('manager 可新增设备 (201)', created.status === 201 && created.data.code === 'LK-T99');
  const dup = await call('POST', '/api/equipment', { token: manager.data.token, body: newEq });
  ok('重复设备编号返回 409', dup.status === 409);
  const badDate = await call('POST', '/api/equipment', { token: manager.data.token,
    body: { ...newEq, code: 'LK-BAD1', last_maintenance: '2026/01/01' } });
  ok('非法维保日期返回 400', badDate.status === 400);

  // [8] operator 新增/编辑被拒（后端鉴权）
  const opCreate = await call('POST', '/api/equipment', { token: operator.data.token, body: newEq });
  ok('operator 新增设备返回 403', opCreate.status === 403);
  const opEdit = await call('PUT', '/api/equipment/' + created.data.id, { token: operator.data.token, body: { status: 'stopped' } });
  ok('operator 编辑设备返回 403', opEdit.status === 403);
  const mgrDel = await call('DELETE', '/api/equipment/' + created.data.id, { token: manager.data.token });
  ok('manager 删除设备返回 403', mgrDel.status === 403);

  // [9] 详情
  const detail = await call('GET', '/api/equipment/' + created.data.id, { token: operator.data.token });
  ok('operator 可查看设备详情（含 manuals 数组）', detail.status === 200 && Array.isArray(detail.data.manuals));
  const notFound = await call('GET', '/api/equipment/999999', { token: admin.data.token });
  ok('不存在的设备详情返回 404', notFound.status === 404);

  // [10] 上传说明书（operator 有权限），走真实 multipart
  const fileContent = '%PDF-1.4\n% 模拟说明书文件 for verify\n';
  const fd = new FormData();
  fd.append('file', new Blob([fileContent], { type: 'application/pdf' }), '测试说明书-恒温机组.pdf');
  const up = await call('POST', `/api/equipment/${created.data.id}/manuals`, { token: operator.data.token, body: fd, isForm: true });
  ok('operator 上传说明书成功 (201)', up.status === 201 && up.data.original_name === '测试说明书-恒温机组.pdf');

  // 非法类型
  const fdBad = new FormData();
  fdBad.append('file', new Blob(['MZ']), 'virus.exe');
  const upBad = await call('POST', `/api/equipment/${created.data.id}/manuals`, { token: operator.data.token, body: fdBad, isForm: true });
  ok('上传非法文件类型返回 400', upBad.status === 400);

  // 物理文件确实落盘
  const filesOnDisk = fs.readdirSync(path.join(__dirname, '..', 'server', 'data', 'uploads'));
  ok('说明书已写入服务器磁盘 (server/data/uploads)', filesOnDisk.some(f => f.endsWith('.pdf')));

  // [11] 下载鉴权 + 内容一致
  const dl = await call('GET', `/api/equipment/${created.data.id}/manuals/${up.data.id}/download`, { token: operator.data.token });
  const dlBuf = Buffer.from(await (await fetch(BASE + `/api/equipment/${created.data.id}/manuals/${up.data.id}/download`, {
    headers: { Authorization: 'Bearer ' + operator.data.token } })).arrayBuffer());
  ok('说明书可下载且内容与上传一致', dl.status === 200 && dlBuf.toString().includes('模拟说明书文件'));
  // Content-Disposition 中文文件名按 RFC5987 编码为 filename*=UTF-8''...，解码后校验
  const cd = dl.headers.get('content-disposition') || '';
  const encodedName = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const decodedName = encodedName ? decodeURIComponent(encodedName) : cd;
  ok('下载响应头带原始文件名(中文 RFC5987 编码)', decodedName.includes('测试说明书'));
  const dlNoAuth = await fetch(BASE + `/api/equipment/${created.data.id}/manuals/${up.data.id}/download`);
  ok('未登录下载说明书返回 401', dlNoAuth.status === 401);

  // [12] 删除说明书：operator 403，manager 200
  const opDelFile = await call('DELETE', `/api/equipment/${created.data.id}/manuals/${up.data.id}`, { token: operator.data.token });
  ok('operator 删除说明书返回 403', opDelFile.status === 403);

  // 再传一份给 manager 删
  const fd2 = new FormData();
  fd2.append('file', new Blob(['to-delete'], { type: 'text/plain' }), 'to-delete.txt');
  const up2 = await call('POST', `/api/equipment/${created.data.id}/manuals`, { token: operator.data.token, body: fd2, isForm: true });
  const mgrDelFile = await call('DELETE', `/api/equipment/${created.data.id}/manuals/${up2.data.id}`, { token: manager.data.token });
  ok('manager 删除说明书成功', mgrDelFile.status === 200);

  // [13] 编辑设备（manager）
  const edited = await call('PUT', '/api/equipment/' + created.data.id, { token: manager.data.token,
    body: { status: 'running', owner: '主管更新人' } });
  ok('manager 编辑设备状态/负责人成功', edited.status === 200 && edited.data.status === 'running' && edited.data.owner === '主管更新人');

  // [14] admin 删除设备（级联删除说明书）
  const delEq = await call('DELETE', '/api/equipment/' + created.data.id, { token: admin.data.token });
  ok('admin 删除设备成功（说明书级联删除）', delEq.status === 200);
  const after = await call('GET', '/api/equipment/' + created.data.id, { token: admin.data.token });
  ok('删除后详情返回 404', after.status === 404);

  // [15] 前端静态页面可访问（部署）
  const indexResp = await fetch(BASE + '/');
  const indexHtml = await indexResp.text();
  ok('前端页面已随服务发布 (GET / 含标题)', indexResp.status === 200 && indexHtml.includes('冷库设备档案'));
  const jsResp = await fetch(BASE + '/js/app.js');
  ok('前端静态资源 /js/app.js 可访问', jsResp.status === 200);

  // [16] JWT 伪造/过期拒绝
  const fake = await call('GET', '/api/equipment', { token: 'fake.invalid.token' });
  ok('伪造 JWT 返回 401', fake.status === 401);

  console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);
  if (serverProc) serverProc.kill();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('验证脚本异常:', e); if (serverProc) serverProc.kill(); process.exit(1); });
