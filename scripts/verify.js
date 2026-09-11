'use strict';
/**
 * 端到端冒烟验证：启动临时服务实例，覆盖
 * 1) 认证与会话  2) 三级角色权限  3) 设备 CRUD  4) 温区/状态筛选
 * 5) 说明书上传/下载/删除  6) 越权拦截  7) 用户管理
 * 使用独立临时数据目录，不影响正式数据。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstore-verify-'));
process.env.DATA_DIR = path.join(tmpRoot, 'data');
process.env.UPLOAD_DIR = path.join(tmpRoot, 'uploads');
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.SESSION_SECRET = 'verify-secret';
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function client() {
  const cookie = {};
  function parseCookies(sc) {
            (sc || []).flatMap(v => v.split(/,(?=[^;]+=)/)).forEach(p => {
      const [k, ...v] = p.split(';')[0].split('=');
      if (k.trim()) cookie[k.trim()] = v.join('=');
    });
  }
  async function call(method, p, body, raw = false) {
    const headers = {};
    const sid = cookie.cs_sid;
    if (sid) headers.Cookie = 'cs_sid=' + sid;
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const resp = await fetch(BASE + p, {
      method, headers,
      body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)),
      redirect: 'manual'
    });
    parseCookies(resp.headers.getSetCookie ? resp.headers.getSetCookie() : []);
    let json = null, text = '';
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) json = await resp.json();
    else text = await resp.text();
    return { status: resp.status, json, text, headers: resp.headers, resp };
  }
  return {
    get: p => call('GET', p),
    post: (p, b) => call('POST', p, b || {}),
    put: (p, b) => call('PUT', p, b),
    del: p => call('DELETE', p),
    upload(p, fileBuffer, filename, mime) {
      const fd = new FormData();
      fd.append('file', new Blob([fileBuffer], { type: mime }), filename);
      return call('POST', p, fd);
    },
    download(p) { return call('GET', p); }
  };
}

async function waitReady(proc) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/auth/me'); if (r.status === 401) return; } catch (_) {}
    if (proc.exitCode !== null) throw new Error('服务进程提前退出');
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('服务启动超时');
}

(async () => {
  console.log(`▶ 临时目录: ${tmpRoot}`);
  const app = require('../server/index.js'); // 迁移在 require 时执行
  const { db } = require('../server/db');
  const { hashPassword } = require('../server/auth');
  // 初始化三个角色
  for (const [u, p, rn, role] of [
    ['admin', 'admin123', '管理员', 'admin'],
    ['manager', 'manager123', '设备管理员', 'manager'],
    ['viewer', 'viewer123', '只读用户', 'viewer']
  ]) {
    db.prepare('INSERT INTO users (username,password_hash,real_name,role) VALUES (?,?,?,?)')
      .run(u, hashPassword(p), rn, role);
  }
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise(r => server.once('listening', r));

  try {
    const anon = client(), admin = client(), manager = client(), viewer = client();

    console.log('\n[1] 未认证访问被拦截');
    let r = await anon.get('/api/equipment');
    check('未登录 GET /api/equipment 返回 401', r.status === 401);

    console.log('\n[2] 登录与错误密码');
    r = await anon.post('/api/auth/login', { username: 'admin', password: 'wrong' });
    check('错误密码返回 401', r.status === 401);
    r = await admin.post('/api/auth/login', { username: 'admin', password: 'admin123' });
    check('admin 登录成功', r.status === 200 && r.json.data.role === 'admin');
    await manager.post('/api/auth/login', { username: 'manager', password: 'manager123' });
    await viewer.post('/api/auth/login', { username: 'viewer', password: 'viewer123' });
    r = await viewer.get('/api/auth/me');
    check('会话保持（/me 返回当前用户）', r.json.data.username === 'viewer');

    console.log('\n[3] 设备新建与权限');
    const validEquip = {
      code: 'TEST-001', name: '验证用制冷机', temp_zone: '速冻',
      location: '测试机房', owner: '测试员', last_maintenance_at: '2026-09-01',
      status: 'running', remark: 'verify'
    };
    r = await viewer.post('/api/equipment', validEquip);
    check('viewer 新建设备被拒（403）', r.status === 403);
    r = await manager.post('/api/equipment', validEquip);
    check('manager 新建设备成功（201）', r.status === 201);
    const id = r.json.data.id;

    r = await manager.post('/api/equipment', { ...validEquip, code: 'BAD-1', temp_zone: '北极' });
    check('非法温区被校验拒绝（400）', r.status === 400);
    r = await manager.post('/api/equipment', { ...validEquip, code: 'TEST-001' });
    check('重复设备编号返回 409', r.status === 409);

    console.log('\n[4] 列表筛选');
    await manager.post('/api/equipment', { ...validEquip, code: 'TEST-002', temp_zone: '冷藏', status: 'fault' });
    r = await viewer.get('/api/equipment');
    check('viewer 可查看列表（200 且 ≥2 条）', r.status === 200 && r.json.data.length >= 2);
    r = await viewer.get('/api/equipment?temp_zone=' + encodeURIComponent('速冻'));
    check('按温区=速冻筛选，结果全部为速冻',
      r.json.data.every(x => x.temp_zone === '速冻') && r.json.data.some(x => x.code === 'TEST-001'));
    r = await viewer.get('/api/equipment?status=fault');
    check('按状态=fault筛选，结果全部为故障', r.json.data.every(x => x.status === 'fault')
      && r.json.data.some(x => x.code === 'TEST-002'));
    r = await viewer.get('/api/equipment?temp_zone=' + encodeURIComponent('冷藏') + '&status=fault');
    check('温区+状态组合筛选正确', r.json.data.length === 1 && r.json.data[0].code === 'TEST-002');
    r = await viewer.get('/api/equipment?status=hacked');
    check('非法筛选参数返回 400', r.status === 400);

    console.log('\n[5] 详情与编辑权限');
    r = await viewer.get('/api/equipment/' + id);
    check('viewer 可查看详情且含 manuals 数组', r.status === 200 && Array.isArray(r.json.data.manuals));
    r = await viewer.put('/api/equipment/' + id, { ...validEquip, name: '被改了' });
    check('viewer 编辑设备被拒（403）', r.status === 403);
    r = await manager.put('/api/equipment/' + id, { ...validEquip, name: '验证用制冷机-改名', status: 'maintenance' });
    check('manager 编辑设备成功', r.status === 200 && r.json.data.name.endsWith('改名'));

    console.log('\n[6] 说明书上传 / 下载 / 删除');
    const pdf = Buffer.from('%PDF-1.4\n% simulated pdf content for verification\n', 'utf8');
    r = await viewer.upload(`/api/equipment/${id}/manuals`, pdf, '说明书.pdf', 'application/pdf');
    check('viewer 上传说明书被拒（403）', r.status === 403);
    r = await manager.upload(`/api/equipment/${id}/manuals`, pdf, '压缩机说明书.pdf', 'application/pdf');
    check('manager 上传 PDF 说明书成功（201）', r.status === 201 && r.json.data.original_name === '压缩机说明书.pdf');
    const fileId = r.json.data.id;
    check('上传记录包含大小与上传人', r.json.data.size === pdf.length && !!r.json.data.uploaded_at);

    r = await manager.upload(`/api/equipment/${id}/manuals`, Buffer.from('MZ\x90'), 'evil.exe', 'application/x-msdownload');
    check('非白名单类型被拒绝（400）', r.status === 400);

    r = await viewer.download('/api/manuals/' + fileId + '/download');
    check('viewer 可下载说明书（200）', r.status === 200);
    check('下载内容与上传一致', r.text === pdf.toString('utf8'));
    const cd = r.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const decodedName = star ? decodeURIComponent(star[1]) : '';
    check('下载响应保留中文文件名(RFC5987)', decodedName === '压缩机说明书.pdf');
    check('下载响应含 ASCII fallback 文件名', /filename="[^"]+\.pdf"/.test(cd));

    r = await viewer.get('/api/equipment/' + id);
    check('详情接口返回已上传的说明书列表', r.json.data.manuals.length === 1
      && r.json.data.manuals[0].id === fileId);

    r = await viewer.del('/api/manuals/' + fileId);
    check('viewer 删除说明书被拒（403）', r.status === 403);
    r = await manager.del('/api/manuals/' + fileId);
    check('manager 删除说明书成功', r.status === 200);
    r = await manager.download('/api/manuals/' + fileId + '/download');
    check('删除后文件不可再下载（404）', r.status === 404);

    console.log('\n[7] 用户管理（仅 admin）');
    r = await manager.get('/api/users');
    check('manager 访问用户管理被拒（403）', r.status === 403);
    r = await admin.get('/api/users');
    check('admin 可查看用户列表', r.status === 200 && r.json.data.length === 3);
    r = await admin.post('/api/users', { username: 'newbie', password: 'pw1234', real_name: '新人', role: 'viewer' });
    check('admin 新建用户成功', r.status === 201);
    r = await admin.post('/api/users', { username: 'newbie2', password: '12', real_name: '短密码', role: 'viewer' });
    check('密码不足 6 位被拒（400）', r.status === 400);
    const newbie = client();
    r = await newbie.post('/api/auth/login', { username: 'newbie', password: 'pw1234' });
    check('新用户可登录', r.status === 200);
    const newbieId = (await admin.get('/api/users')).json.data.find(u => u.username === 'newbie').id;
    r = await admin.put('/api/users/' + newbieId, { role: 'manager' });
    check('admin 调整用户角色成功', r.status === 200 && r.json.data.role === 'manager');
    const adminId = (await admin.get('/api/users')).json.data.find(u => u.username === 'admin').id;
    r = await admin.put('/api/users/' + adminId, { active: 0 });
    check('admin 不能停用自己（400）', r.status === 400);

    console.log('\n[7b] 用户姓名编辑持久化（回归）');
    r = await admin.put('/api/users/' + newbieId, { real_name: '新人改' });
    check('修改姓名接口返回新姓名', r.status === 200 && r.json.data.real_name === '新人改');
    r = await admin.get('/api/users');
    check('姓名已持久化（重新查询为新值）',
      r.json.data.find(u => u.id === newbieId).real_name === '新人改');
    r = await newbie.get('/api/auth/me');
    check('被改用户的会话实时反映新姓名', r.status === 200 && r.json.data.realName === '新人改');
    r = await admin.put('/api/users/' + newbieId, { real_name: '   ' });
    check('空白姓名被拒（400）', r.status === 400);

    console.log('\n[7c] 角色降级/停用对旧会话即时生效（回归）');
    // newbie 当前为 manager（上文已调整），先确认其旧会话可编辑设备
    r = await newbie.put('/api/equipment/' + id, { ...validEquip, name: 'newbie改的' });
    check('降级前 newbie(manager) 可编辑设备', r.status === 200);
    r = await admin.put('/api/users/' + newbieId, { role: 'viewer' });
    check('admin 将 newbie 降级为 viewer', r.status === 200 && r.json.data.role === 'viewer');
    r = await newbie.put('/api/equipment/' + id, { ...validEquip, name: '不该生效' });
    check('降级后旧会话编辑设备被拒（403）', r.status === 403);
    r = await newbie.post('/api/equipment', { ...validEquip, code: 'TEST-403' });
    check('降级后旧会话新建设备被拒（403）', r.status === 403);
    r = await newbie.get('/api/equipment');
    check('降级后旧会话仍可按 viewer 查看列表', r.status === 200);
    r = await newbie.get('/api/auth/me');
    check('旧会话角色实时刷新为 viewer', r.status === 200 && r.json.data.role === 'viewer');
    r = await admin.put('/api/users/' + newbieId, { active: 0 });
    check('admin 停用 newbie 账号', r.status === 200 && r.json.data.active === 0);
    r = await newbie.get('/api/equipment');
    check('停用后旧会话立即失效（401）', r.status === 401);
    r = await newbie.post('/api/auth/login', { username: 'newbie', password: 'pw1234' });
    check('停用账号无法再登录（401）', r.status === 401);

    console.log('\n[8] 前端与静态资源');
    r = await fetch(BASE + '/');
    let homeHtml = await r.text();
    check('首页返回 200 且含挂载点', r.status === 200 && homeHtml.includes('id="app"'));
    r = await fetch(BASE + '/js/app.js');
    let appJs = await r.text();
    check('前端脚本可访问', r.status === 200 && appJs.includes('renderList'));
    r = await fetch(BASE + '/some/spa/route', { redirect: 'manual' });
    let spaHtml = await r.text();
    check('未知非 API 路径回退到 index.html（SPA）', r.status === 200 && spaHtml.includes('id="app"'));

    console.log('\n[9] 自定义数据目录与 .env 加载（回归）');
    check('数据库文件落在自定义 DATA_DIR',
      db.name === path.join(process.env.DATA_DIR, 'coldstore.db'));
    const { loadEnv } = require('../server/env');
    const envFile = path.join(tmpRoot, '.env.test');
    fs.writeFileSync(envFile, '# 注释行\nVERIFY_ENV_A=hello\nVERIFY_ENV_B="quoted val"\n\nVERIFY_ENV_A=second\n');
    delete process.env.VERIFY_ENV_A;
    delete process.env.VERIFY_ENV_B;
    loadEnv(envFile);
    check('.env 解析并注入变量（重复键取首次）', process.env.VERIFY_ENV_A === 'hello');
    check('.env 支持引号包裹的值', process.env.VERIFY_ENV_B === 'quoted val');
    process.env.VERIFY_ENV_C = 'keep';
    fs.writeFileSync(envFile, 'VERIFY_ENV_C=override\n');
    loadEnv(envFile);
    check('.env 不覆盖已存在的环境变量', process.env.VERIFY_ENV_C === 'keep');

  } finally {
    server.close();
    await new Promise(r => setTimeout(r, 100));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n════════ 验证结果：${pass} 通过, ${fail} 失败 ════════`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验证脚本异常:', e); process.exit(2); });
