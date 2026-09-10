'use strict';

/* ================= 全局状态与工具 ================= */
const STATE = { user: null, meta: null };

const STATUS_LABEL = { running: '运行', stopped: '停机', maintenance: '维保中', fault: '故障' };
const ROLE_LABEL = { viewer: '只读用户', manager: '设备管理员', admin: '系统管理员' };

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function canManage() { return STATE.user && ['manager', 'admin'].includes(STATE.user.role); }
function isAdmin() { return STATE.user && STATE.user.role === 'admin'; }

function modal(html) {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal">${html}</div>`;
    mask.addEventListener('click', e => { if (e.target === mask) close(null); });
    function close(v) { mask.remove(); resolve(v); }
    mask._close = close;
    document.body.appendChild(mask);
  });
}

/* ================= 路由 ================= */
async function boot() {
  try {
    STATE.user = await Api.get('/api/auth/me');
  } catch (_) { STATE.user = null; }
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (!STATE.user) {
    if (hash !== '/login') return location.hash = '/login';
    return renderLogin();
  }
  if (hash === '/login') return location.hash = '/equipment';

  const m = hash.match(/^\/equipment\/(\d+)$/);
  if (m) return renderDetail(Number(m[1]));
  if (hash === '/equipment') return renderList();
  if (hash === '/users') return isAdmin() ? renderUsers() : (location.hash = '/equipment');
  location.hash = '/equipment';
}

function go(h) { location.hash = h; }

/* ================= 登录页 ================= */
function renderLogin() {
  document.getElementById('app').innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="loginForm">
      <h1>❄ 冷库设备档案系统</h1>
      <div class="sub">Cold Storage Equipment Archive</div>
      <div class="form-row"><div class="field" style="width:100%">
        <label>用户名</label><input name="username" autocomplete="username" required>
      </div></div>
      <div class="form-row"><div class="field" style="width:100%">
        <label>密码</label><input name="password" type="password" autocomplete="current-password" required>
      </div></div>
      <button class="btn btn-primary" style="width:100%" type="submit">登 录</button>
      <div class="hint">
        演示账号：<br>
        admin / admin123（系统管理员）<br>
        manager / manager123（设备管理员）<br>
        viewer / viewer123（只读用户）
      </div>
    </form>
  </div>`;
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      STATE.user = await Api.post('/api/auth/login', {
        username: fd.get('username'), password: fd.get('password')
      });
      STATE.meta = null;
      location.hash = '/equipment';
    } catch (err) { toast(err.message, false); }
  });
}

/* ================= 主框架 & 菜单 ================= */
function layout(active, title, contentHtml) {
  const menu = [
    { key: 'equipment', hash: '#/equipment', ico: '🗂', label: '设备档案', show: true },
    { key: 'users', hash: '#/users', ico: '👥', label: '用户与权限', show: isAdmin() }
  ].filter(i => i.show);

  document.getElementById('app').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">❄ 冷库设备档案<small>Cold Storage Archive</small></div>
      <ul class="menu">
        ${menu.map(i => `<li data-hash="${i.hash}" class="${i.key === active ? 'active' : ''}">
          <span class="ico">${i.ico}</span>${i.label}</li>`).join('')}
      </ul>
      <div class="user-box">
        <div class="name">${esc(STATE.user.realName)}</div>
        <span class="role-tag">${ROLE_LABEL[STATE.user.role]}</span>
        <button class="btn btn-sm btn-logout" id="btnLogout">退出登录</button>
      </div>
    </aside>
    <div class="main">
      <div class="topbar">${title}</div>
      <div class="content" id="content">${contentHtml}</div>
    </div>
  </div>`;
  document.querySelectorAll('.menu li').forEach(li =>
    li.addEventListener('click', () => location.hash = li.dataset.hash.slice(1)));
  document.getElementById('btnLogout').addEventListener('click', async () => {
    await Api.post('/api/auth/logout', {});
    STATE.user = null;
    location.hash = '/login';
  });
}

/* ================= 设备列表 ================= */
const listState = { temp_zone: '', status: '', keyword: '' };

async function renderList() {
  layout('equipment', '设备档案', `
    <div class="card">
      <div class="filter-bar">
        <div class="field"><label>温区</label>
          <select id="fZone"><option value="">全部温区</option></select></div>
        <div class="field"><label>运行状态</label>
          <select id="fStatus"><option value="">全部状态</option></select></div>
        <div class="field" style="width:220px"><label>关键字</label>
          <input id="fKw" placeholder="编号 / 名称 / 位置 / 负责人"></div>
        <button class="btn" id="btnReset">重置</button>
        <div class="spacer"></div>
        ${canManage() ? '<button class="btn btn-primary" id="btnNew">＋ 新建设备</button>' : ''}
      </div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table><thead><tr>
        <th>设备编号</th><th>名称</th><th>温区</th><th>安装位置</th><th>负责人</th>
        <th>最近维保日期</th><th>运行状态</th><th>操作</th>
      </tr></thead><tbody id="tb"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody></table>
    </div>`);

  if (!STATE.meta) STATE.meta = await Api.get('/api/equipment/meta');
  const zoneSel = document.getElementById('fZone');
  STATE.meta.zones.forEach(z => zoneSel.insertAdjacentHTML('beforeend',
    `<option value="${z}" ${listState.temp_zone === z ? 'selected' : ''}>${z}</option>`));
  const statusSel = document.getElementById('fStatus');
  STATE.meta.statuses.forEach(s => statusSel.insertAdjacentHTML('beforeend',
    `<option value="${s.value}" ${listState.status === s.value ? 'selected' : ''}>${s.label}</option>`));
  document.getElementById('fKw').value = listState.keyword;

  zoneSel.addEventListener('change', () => { listState.temp_zone = zoneSel.value; loadRows(); });
  statusSel.addEventListener('change', () => { listState.status = statusSel.value; loadRows(); });
  let kwTimer;
  document.getElementById('fKw').addEventListener('input', e => {
    clearTimeout(kwTimer);
    kwTimer = setTimeout(() => { listState.keyword = e.target.value.trim(); loadRows(); }, 300);
  });
  document.getElementById('btnReset').addEventListener('click', () => {
    listState.temp_zone = listState.status = listState.keyword = '';
    renderList();
  });
  if (canManage()) document.getElementById('btnNew').addEventListener('click', () => equipForm(null));

  loadRows();
}

async function loadRows() {
  const qs = new URLSearchParams();
  if (listState.temp_zone) qs.set('temp_zone', listState.temp_zone);
  if (listState.status) qs.set('status', listState.status);
  if (listState.keyword) qs.set('keyword', listState.keyword);
  const tb = document.getElementById('tb');
  try {
    const rows = await Api.get('/api/equipment?' + qs.toString());
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">没有符合条件的设备</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(r => `
      <tr>
        <td><a href="#/equipment/${r.id}">${esc(r.code)}</a></td>
        <td>${esc(r.name)}</td>
        <td><span class="zone-tag">${esc(r.temp_zone)}</span></td>
        <td>${esc(r.location)}</td>
        <td>${esc(r.owner)}</td>
        <td>${r.last_maintenance_at ? esc(r.last_maintenance_at) : '<span class="text-muted">—</span>'}</td>
        <td><span class="badge badge-${r.status}">${STATUS_LABEL[r.status]}</span></td>
        <td><a class="btn btn-sm" href="#/equipment/${r.id}">详情</a></td>
      </tr>`).join('');
  } catch (err) {
    tb.innerHTML = `<tr><td colspan="8" class="empty text-danger">${esc(err.message)}</td></tr>`;
  }
}

/* ================= 设备表单（新建/编辑） ================= */
async function equipForm(equip) {
  if (!STATE.meta) STATE.meta = await Api.get('/api/equipment/meta');
  const e = equip || {};
  const m = await modal(`
    <div class="modal-head">${equip ? '编辑设备' : '新建设备'}<span class="close-x" data-cancel>✕</span></div>
    <div class="modal-body">
      <form id="equipForm">
        <div class="form-row">
          <div class="field"><label>设备编号 *</label><input name="code" value="${esc(e.code || '')}" required ${equip ? 'readonly' : ''}></div>
          <div class="field"><label>名称 *</label><input name="name" value="${esc(e.name || '')}" required></div>
        </div>
        <div class="form-row">
          <div class="field"><label>温区 *</label><select name="temp_zone">
            ${STATE.meta.zones.map(z => `<option ${e.temp_zone === z ? 'selected' : ''}>${z}</option>`).join('')}
          </select></div>
          <div class="field"><label>运行状态 *</label><select name="status">
            ${STATE.meta.statuses.map(s => `<option value="${s.value}" ${e.status === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select></div>
        </div>
        <div class="form-row">
          <div class="field"><label>安装位置 *</label><input name="location" value="${esc(e.location || '')}" required></div>
          <div class="field"><label>负责人 *</label><input name="owner" value="${esc(e.owner || '')}" required></div>
        </div>
        <div class="form-row">
          <div class="field"><label>最近维保日期</label><input type="date" name="last_maintenance_at" value="${esc(e.last_maintenance_at || '')}"></div>
          <div class="field"><label>备注</label><input name="remark" value="${esc(e.remark || '')}"></div>
        </div>
      </form>
    </div>
    <div class="modal-foot">
      <button class="btn" data-cancel>取消</button>
      <button class="btn btn-primary" id="btnSave">保存</button>
    </div>`);
  m.querySelectorAll('[data-cancel]').forEach(el => el.onclick = () => m._close());
  m.querySelector('#btnSave').onclick = async () => {
    const fd = new FormData(m.querySelector('#equipForm'));
    const body = Object.fromEntries(fd.entries());
    try {
      if (equip) await Api.put('/api/equipment/' + equip.id, body);
      else await Api.post('/api/equipment', body);
      toast('保存成功');
      m._close();
      if (equip) route(); else loadRows();
    } catch (err) { toast(err.message, false); }
  };
}

/* ================= 设备详情 + 说明书 ================= */
async function renderDetail(id) {
  layout('equipment', '设备详情', '<div class="empty">加载中…</div>');
  let d;
  try { d = await Api.get('/api/equipment/' + id); }
  catch (err) { document.getElementById('content').innerHTML = `<div class="card empty text-danger">${esc(err.message)}</div>`; return; }

  const c = document.getElementById('content');
  c.innerHTML = `
    <a class="back-link" href="#/equipment">← 返回列表</a>
    <div class="card">
      <div class="detail-head">
        <div>
          <h2>${esc(d.name)}
            <span class="zone-tag" style="margin-left:8px">${esc(d.temp_zone)}</span>
            <span class="badge badge-${d.status}" style="margin-left:6px">${STATUS_LABEL[d.status]}</span>
          </h2>
          <div class="text-muted" style="margin-top:4px">编号 ${esc(d.code)}</div>
        </div>
        ${canManage() ? `<div>
          <button class="btn" id="btnEdit">编辑</button>
          <button class="btn btn-danger" id="btnDel">删除</button>
        </div>` : ''}
      </div>
      <div class="dl" style="margin-top:18px">
        <div class="item"><div class="k">安装位置</div><div class="v">${esc(d.location)}</div></div>
        <div class="item"><div class="k">负责人</div><div class="v">${esc(d.owner)}</div></div>
        <div class="item"><div class="k">最近维保日期</div><div class="v">${d.last_maintenance_at ? esc(d.last_maintenance_at) : '—'}</div></div>
        <div class="item"><div class="k">建档时间</div><div class="v">${esc(d.created_at)}</div></div>
        <div class="item"><div class="k">最后更新</div><div class="v">${esc(d.updated_at)}</div></div>
        <div class="item"><div class="k">备注</div><div class="v">${esc(d.remark || '—')}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">设备说明书</div>
      ${canManage() ? `
      <div class="upload-zone" id="upZone">
        <div style="font-size:26px">📄</div>
        <div>点击选择文件，或将文件拖拽到此处上传</div>
        <div class="text-muted" style="font-size:12px;margin-top:6px">
          支持 PDF / Word / Excel / 图片 / TXT，单个文件最大 20MB</div>
        <input type="file" id="fileInput" style="display:none">
      </div>` : ''}
      <div id="fileList"></div>
    </div>`;

  if (canManage()) {
    document.getElementById('btnEdit').onclick = () => equipForm(d);
    document.getElementById('btnDel').onclick = async () => {
      if (!confirm(`确认删除设备「${d.name}」及其全部说明书？此操作不可恢复。`)) return;
      try {
        await Api.del('/api/equipment/' + d.id);
        toast('已删除');
        go('/equipment');
      } catch (err) { toast(err.message, false); }
    };
    bindUpload(d.id);
  }
  renderFiles(d);
}

function renderFiles(d) {
  const box = document.getElementById('fileList');
  if (!d.manuals.length) {
    box.innerHTML = '<div class="empty">暂无说明书文件</div>';
    return;
  }
  box.innerHTML = d.manuals.map(f => `
    <div class="file-row">
      <div class="f-ico">📎</div>
      <div class="f-meta">
        <div class="f-name">${esc(f.original_name)}</div>
        <div class="f-sub">${fmtSize(f.size)} · 上传人 ${esc(f.uploaded_by_name || '—')} · ${esc(f.uploaded_at)}</div>
      </div>
      <a class="btn btn-sm" href="/api/manuals/${f.id}/download">下载</a>
      ${canManage() ? `<button class="btn btn-sm btn-danger" data-del="${f.id}">删除</button>` : ''}
    </div>`).join('');
  box.querySelectorAll('[data-del]').forEach(btn => btn.onclick = async () => {
    if (!confirm('确认删除该说明书文件？')) return;
    try {
      await Api.del('/api/manuals/' + btn.dataset.del);
      d.manuals = d.manuals.filter(x => x.id !== Number(btn.dataset.del));
      renderFiles(d);
      toast('已删除');
    } catch (err) { toast(err.message, false); }
  });
}

function bindUpload(equipId) {
  const zone = document.getElementById('upZone');
  const input = document.getElementById('fileInput');
  zone.onclick = () => input.click();
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag'); };
  zone.ondragleave = () => zone.classList.remove('drag');
  zone.ondrop = e => {
    e.preventDefault();
    zone.classList.remove('drag');
    if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files[0]);
  };
  input.onchange = () => { if (input.files.length) doUpload(input.files[0]); };

  async function doUpload(file) {
    const fd = new FormData();
    fd.append('file', file);
    zone.textContent = '上传中…';
    try {
      await Api.upload(`/api/equipment/${equipId}/manuals`, fd);
      toast('说明书上传成功');
      route(); // 刷新详情
    } catch (err) {
      toast(err.message, false);
      renderDetail(equipId);
    }
  }
}

/* ================= 用户与权限（admin） ================= */
async function renderUsers() {
  layout('users', '用户与权限', `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="text-muted">角色说明：
          <b>只读用户</b> 仅可查看；<b>设备管理员</b> 可管理设备与说明书；<b>系统管理员</b> 额外可管理用户</div>
        <button class="btn btn-primary" id="btnNewUser">＋ 新建用户</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table><thead><tr>
        <th>ID</th><th>用户名</th><th>姓名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th>
      </tr></thead><tbody id="ub"></tbody></table>
    </div>`);
  document.getElementById('btnNewUser').onclick = () => userForm(null);
  loadUsers();
}

async function loadUsers() {
  const rows = await Api.get('/api/users');
  document.getElementById('ub').innerHTML = rows.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${esc(u.username)}</td>
      <td>${esc(u.real_name)}</td>
      <td><span class="role-tag" style="background:#eaf3fc;color:#1c6dd0">${ROLE_LABEL[u.role]}</span></td>
      <td>${u.active ? '<span class="badge badge-running">启用</span>' : '<span class="badge badge-stopped">停用</span>'}</td>
      <td>${esc(u.created_at)}</td>
      <td><button class="btn btn-sm" data-edit="${u.id}">编辑/重置密码</button></td>
    </tr>`).join('');
  document.querySelectorAll('[data-edit]').forEach(b =>
    b.onclick = () => userForm(rows.find(x => x.id === Number(b.dataset.edit))));
}

async function userForm(u) {
  const m = await modal(`
    <div class="modal-head">${u ? '编辑用户' : '新建用户'}<span class="close-x" data-cancel>✕</span></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="field"><label>用户名 *</label><input id="uUsername" value="${esc(u ? u.username : '')}" ${u ? 'readonly' : ''}></div>
        <div class="field"><label>姓名 *</label><input id="uRealName" value="${esc(u ? u.real_name : '')}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>角色 *</label><select id="uRole">
          ${['viewer', 'manager', 'admin'].map(r =>
            `<option value="${r}" ${u && u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
        </select></div>
        ${u ? `<div class="field"><label>账号状态</label><select id="uActive">
          <option value="1" ${u.active ? 'selected' : ''}>启用</option>
          <option value="0" ${!u.active ? 'selected' : ''}>停用</option>
        </select></div>` : ''}
      </div>
      <div class="form-row"><div class="field">
        <label>${u ? '重置密码（留空则不修改）' : '初始密码 *（至少6位）'}</label>
        <input type="password" id="uPassword" autocomplete="new-password"></div></div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-cancel>取消</button>
      <button class="btn btn-primary" id="uSave">保存</button>
    </div>`);
  m.querySelectorAll('[data-cancel]').forEach(el => el.onclick = () => m._close());
  m.querySelector('#uSave').onclick = async () => {
    const username = m.querySelector('#uUsername').value.trim();
    const real_name = m.querySelector('#uRealName').value.trim();
    const role = m.querySelector('#uRole').value;
    const password = m.querySelector('#uPassword').value;
    try {
      if (u) {
        await Api.put('/api/users/' + u.id, { real_name, role,
          active: m.querySelector('#uActive') ? Number(m.querySelector('#uActive').value) : undefined,
          password: password || undefined });
      } else {
        if (!username || !real_name || password.length < 6) throw new Error('请完整填写，密码至少 6 位');
        await Api.post('/api/users', { username, real_name, role, password });
      }
      toast('保存成功');
      m._close();
      loadUsers();
    } catch (err) { toast(err.message, false); }
  };
}

boot();
