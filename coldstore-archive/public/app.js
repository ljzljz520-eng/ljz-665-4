/* ============== 工具 ============== */
const $ = sel => document.querySelector(sel);
const app = $('#app');
const state = { me: null, zones: [], statuses: [] };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch('/api' + url, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) { logout(); throw new Error('登录已失效'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function can(code) { return state.me?.permissions?.includes(code); }
function logout() { localStorage.removeItem('token'); location.hash = '#/login'; location.reload(); }

function fmtDate(d) {
  if (!d) return '<span class="muted">未记录</span>';
  const days = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);
  const warn = days > 90 ? ' style="color:var(--red);font-weight:600"' : '';
  return `<span${warn}>${esc(d)}</span>`;
}
function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
function statusBadge(code, name) { return `<span class="badge ${code}">${esc(name)}</span>`; }

/* ============== 登录页 ============== */
function renderLogin() {
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="loginForm">
      <h1>🧊 冷库设备档案管理</h1>
      <div class="sub">Cold Storage Equipment Archive</div>
      <div class="field" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
        <input name="username" placeholder="用户名" autocomplete="username" required>
      </div>
      <div class="field" style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px">
        <input name="password" type="password" placeholder="密码" autocomplete="current-password" required>
      </div>
      <button class="btn" style="width:100%" type="submit">登 录</button>
      <div class="demo">
        演示账号（点击自动填充）：<br>
        <b data-u="admin" data-p="Admin@123">admin / Admin@123</b>（管理员）<br>
        <b data-u="manager" data-p="Manager@123">manager / Manager@123</b>（设备主管）<br>
        <b data-u="viewer" data-p="Viewer@123">viewer / Viewer@123</b>（只读）
      </div>
    </form>
  </div>`;
  document.querySelectorAll('.demo b').forEach(b => b.onclick = () => {
    document.querySelector('[name=username]').value = b.dataset.u;
    document.querySelector('[name=password]').value = b.dataset.p;
  });
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: f.get('username'), password: f.get('password') }),
      });
      localStorage.setItem('token', r.token);
      location.hash = '#/dashboard';
      location.reload();
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* ============== 主框架 ============== */
async function renderApp() {
  state.me = await api('/auth/me');
  [state.zones, state.statuses] = await Promise.all([api('/dict/zones'), api('/dict/statuses')]);

  const active = location.hash || '#/dashboard';
  app.innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">🧊 冷库设备档案<span>EQUIPMENT ARCHIVE</span></div>
      <nav id="menu">
        ${state.me.menus.map(m => `
          <a href="${m.path}" class="${active.startsWith(m.path) ? 'active' : ''}">${m.icon} ${esc(m.name)}</a>`).join('')}
      </nav>
      <div class="user-box">
        <div class="name">${esc(state.me.displayName)}</div>
        <div class="role">${esc(state.me.roleName)} · ${esc(state.me.username)}</div>
        <button onclick="logout()">退出登录</button>
      </div>
    </aside>
    <main class="main" id="view"></main>
  </div>`;
  route();
}

/* ============== 看板 ============== */
async function viewDashboard(view) {
  view.innerHTML = `
    <div class="page-head"><h2>运行看板</h2></div>
    <div class="muted" id="loading">加载中…</div>`;
  const s = await api('/equipment/stats/summary');
  $('#loading')?.remove();
  const maxZone = Math.max(1, ...s.byZone.map(z => z.n));
  const maxSt = Math.max(1, ...s.byStatus.map(x => x.n));
  const statusColor = { running: 'var(--green)', standby: 'var(--gray)', fault: 'var(--red)',
    maintenance: 'var(--amber)', decommissioned: 'var(--blue)' };

  view.insertAdjacentHTML('beforeend', `
    <div class="stats-grid">
      <div class="stat-box"><div class="label">设备总数</div><div class="num">${s.total}</div></div>
      <div class="stat-box alarm"><div class="label">维保超期(>90天/未记录)</div><div class="num">${s.overdue}</div></div>
      <div class="stat-box"><div class="label">运行中</div><div class="num" style="color:var(--green)">${s.byStatus.find(x=>x.code==='running')?.n||0}</div></div>
      <div class="stat-box"><div class="label">故障</div><div class="num" style="color:var(--red)">${s.byStatus.find(x=>x.code==='fault')?.n||0}</div></div>
    </div>
    <div class="stat-grid-2">
      <div class="card">
        <h3 style="margin-bottom:12px;font-size:15px">按温区分布</h3>
        ${s.byZone.map(z => `
          <div class="bar-row">
            <span class="bar-label">${esc(z.name)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${z.n/maxZone*100}%"></span></span>
            <span class="bar-n">${z.n}</span>
          </div>`).join('')}
      </div>
      <div class="card">
        <h3 style="margin-bottom:12px;font-size:15px">按运行状态分布</h3>
        ${s.byStatus.map(x => `
          <div class="bar-row">
            <span class="bar-label">${esc(x.name)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${x.n/maxSt*100}%;background:${statusColor[x.code]}"></span></span>
            <span class="bar-n">${x.n}</span>
          </div>`).join('')}
      </div>
    </div>`);
}

/* ============== 设备列表 ============== */
async function viewEquipment(view) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const fZone = params.get('zone') || '', fStatus = params.get('status') || '', fQ = params.get('q') || '';

  view.innerHTML = `
    <div class="page-head">
      <h2>设备档案</h2>
      ${can('equipment:write') ? '<button class="btn" id="btnAdd">+ 新增设备</button>' : ''}
    </div>
    <div class="card">
      <div class="filters">
        <div class="field"><label>温区</label>
          <select id="fZone"><option value="">全部温区</option>
            ${state.zones.map(z => `<option value="${z.code}" ${fZone===z.code?'selected':''}>${esc(z.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>运行状态</label>
          <select id="fStatus"><option value="">全部状态</option>
            ${state.statuses.map(s => `<option value="${s.code}" ${fStatus===s.code?'selected':''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>关键字（编号/名称/位置/负责人）</label><input id="fQ" value="${esc(fQ)}" style="min-width:260px"></div>
        <button class="btn secondary" id="btnReset">重置</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr>
          <th>设备编号</th><th>设备名称</th><th>温区</th><th>安装位置</th><th>负责人</th>
          <th>最近维保日期</th><th>运行状态</th><th>说明书</th>
        </tr></thead>
        <tbody id="eqBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>`;

  async function load() {
    const qs = new URLSearchParams();
    if (fZone) qs.set('zone', fZone);
    if (fStatus) qs.set('status', fStatus);
    if (fQ.trim()) qs.set('q', fQ.trim());
    const data = await api('/equipment?' + qs.toString());
    const body = $('#eqBody');
    if (!data.items.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">没有符合条件的设备</td></tr>';
    } else {
      body.innerHTML = data.items.map(e => `
        <tr data-id="${e.id}">
          <td><b>${esc(e.code)}</b></td>
          <td>${esc(e.name)}</td>
          <td><span class="zone-tag">${esc(e.zone_name)}</span></td>
          <td>${esc(e.location)}</td>
          <td>${esc(e.owner)}</td>
          <td>${fmtDate(e.last_maintenance_date)}</td>
          <td>${statusBadge(e.status, e.status_name)}</td>
          <td>${e.doc_count ? `📎 ${e.doc_count}` : '<span class="muted">—</span>'}</td>
        </tr>`).join('');
      body.querySelectorAll('tr[data-id]').forEach(tr =>
        tr.onclick = () => location.hash = '#/equipment/' + tr.dataset.id);
    }
  }

  function syncHash() {
    const qs = new URLSearchParams();
    const z = $('#fZone').value, st = $('#fStatus').value, q = $('#fQ').value;
    if (z) qs.set('zone', z);
    if (st) qs.set('status', st);
    if (q.trim()) qs.set('q', q.trim());
    location.hash = '#/equipment' + (qs.toString() ? '?' + qs.toString() : '');
  }

  $('#fZone').onchange = syncHash;
  $('#fStatus').onchange = syncHash;
  let timer;
  $('#fQ').oninput = () => { clearTimeout(timer); timer = setTimeout(syncHash, 350); };
  $('#btnReset').onclick = () => location.hash = '#/equipment';
  $('#btnAdd') && ($('#btnAdd').onclick = () => openEditModal(null, load));
  load();
}

/* ============== 设备详情 ============== */
async function viewDetail(view, id) {
  view.innerHTML = '<div class="muted" style="padding:40px;text-align:center">加载中…</div>';
  let e;
  try { e = await api('/equipment/' + id); }
  catch (err) { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const zoneMap = Object.fromEntries(state.zones.map(z => [z.code, z.name]));
  const statusMap = Object.fromEntries(state.statuses.map(s => [s.code, s.name]));

  view.innerHTML = `
    <div class="breadcrumb"><a href="#/equipment">设备档案</a> / ${esc(e.code)}</div>
    <div class="page-head">
      <h2>${esc(e.name)} <span class="zone-tag">${esc(e.zone_name)}</span> ${statusBadge(e.status, e.status_name)}</h2>
      <div style="display:flex;gap:10px">
        ${can('equipment:write') ? '<button class="btn secondary" id="btnEdit">编辑</button>' : ''}
        ${can('equipment:delete') ? '<button class="btn danger" id="btnDel">删除设备</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="detail-grid">
        <div class="item"><div class="k">设备编号</div><div class="v">${esc(e.code)}</div></div>
        <div class="item"><div class="k">温区 / 温度范围</div><div class="v">${esc(e.zone_name)}（${esc(e.temp_range)}）</div></div>
        <div class="item"><div class="k">运行状态</div><div class="v">${statusBadge(e.status, e.status_name)}</div></div>
        <div class="item"><div class="k">安装位置</div><div class="v">${esc(e.location)}</div></div>
        <div class="item"><div class="k">负责人</div><div class="v">${esc(e.owner)}</div></div>
        <div class="item"><div class="k">最近维保日期</div><div class="v">${fmtDate(e.last_maintenance_date)}</div></div>
        <div class="item" style="grid-column:1/-1"><div class="k">备注</div><div class="v">${e.remark ? esc(e.remark) : '<span class="muted">无</span>'}</div></div>
        <div class="item"><div class="k">建档时间</div><div class="v muted">${esc(e.created_at)}</div></div>
        <div class="item"><div class="k">最后更新</div><div class="v muted">${esc(e.updated_at)}</div></div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:14px;font-size:15px">说明书 / 技术资料</h3>
      ${can('document:upload') ? `
      <div class="upload-zone">
        <form id="uploadForm">
          <input type="file" name="file" id="docFile"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" required>
          <button class="btn" type="submit">上传说明书</button>
          <div class="hint">支持 PDF / Word / JPG / PNG，单个文件 ≤ 20MB</div>
        </form>
      </div>` : '<div class="muted" style="margin-bottom:12px">当前角色仅可查看与下载附件</div>'}
      <div id="docList">${renderDocRows(e)}</div>
    </div>`;

  $('#btnEdit') && ($('#btnEdit').onclick = () => openEditModal(e, () => location.reload()));
  $('#btnDel') && ($('#btnDel').onclick = async () => {
    if (!confirm(`确定删除设备 ${e.code} 及其全部说明书？此操作不可恢复。`)) return;
    try {
      await api('/equipment/' + e.id, { method: 'DELETE' });
      toast('已删除'); location.hash = '#/equipment';
    } catch (err) { toast(err.message, 'err'); }
  });

  const uploadForm = $('#uploadForm');
  if (uploadForm) uploadForm.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData();
    const file = $('#docFile').files[0];
    if (!file) return toast('请选择文件', 'err');
    if (file.size > 20 * 1024 * 1024) return toast('文件不能超过 20MB', 'err');
    fd.append('file', file);
    try {
      await api(`/equipment/${e.id}/documents`, { method: 'POST', body: fd });
      toast('上传成功'); location.reload();
    } catch (err) { toast(err.message, 'err'); }
  };

  view.querySelectorAll('[data-del-doc]').forEach(b => b.onclick = async () => {
    if (!confirm('确定删除该说明书？')) return;
    try {
      await api(`/equipment/${e.id}/documents/${b.dataset.delDoc}`, { method: 'DELETE' });
      toast('已删除'); location.reload();
    } catch (err) { toast(err.message, 'err'); }
  });
}

function renderDocRows(e) {
  if (!e.documents.length) return '<div class="empty">暂无说明书文件</div>';
  return e.documents.map(d => `
    <div class="doc-row">
      <div>
        <div>📎 ${esc(d.original_name)}</div>
        <div class="meta">${fmtSize(d.size_bytes)} · 上传人：${esc(d.uploaded_by_name || '—')} · ${esc(d.uploaded_at)}</div>
      </div>
      <div style="display:flex;gap:8px">
        <a class="btn secondary sm" href="/api/equipment/${e.id}/documents/${d.id}/download"
           onclick="event.preventDefault();downloadDoc(${e.id},${d.id})">下载</a>
        ${can('document:delete') ? `<button class="btn danger sm" data-del-doc="${d.id}">删除</button>` : ''}
      </div>
    </div>`).join('');
}

async function downloadDoc(eqId, docId) {
  const res = await fetch(`/api/equipment/${eqId}/documents/${docId}/download`, {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
  });
  if (!res.ok) return toast('下载失败', 'err');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = '';
  // 用响应头文件名（简化处理：由 Content-Disposition）
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i);
  if (m) a.download = decodeURIComponent(m[1]);
  a.click(); URL.revokeObjectURL(url);
}

/* ============== 新增/编辑弹窗 ============== */
function openEditModal(e, onDone) {
  const isEdit = !!e;
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? '编辑设备' : '新增设备'}</h3>
      <form id="eqForm">
        <div class="form-grid">
          <div><label>设备编号 *</label><input name="code" value="${esc(e?.code||'')}" ${isEdit?'':''} required></div>
          <div><label>设备名称 *</label><input name="name" value="${esc(e?.name||'')}" required></div>
          <div><label>温区 *</label>
            <select name="zone_code" required>
              ${state.zones.map(z => `<option value="${z.code}" ${e?.zone_code===z.code?'selected':''}>${esc(z.name)} (${esc(z.temp_range)})</option>`).join('')}
            </select>
          </div>
          <div><label>运行状态 *</label>
            <select name="status" required>
              ${state.statuses.map(s => `<option value="${s.code}" ${(e?.status||'running')===s.code?'selected':''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div><label>安装位置 *</label><input name="location" value="${esc(e?.location||'')}" required></div>
          <div><label>负责人 *</label><input name="owner" value="${esc(e?.owner||'')}" required></div>
          <div class="full"><label>最近维保日期</label><input type="date" name="last_maintenance_date" value="${esc(e?.last_maintenance_date||'')}"></div>
          <div class="full"><label>备注</label><textarea name="remark">${esc(e?.remark||'')}</textarea></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="mCancel">取消</button>
          <button type="submit" class="btn">${isEdit?'保存':'创建'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.onclick = ev => ev.target === mask && close();
  $('#mCancel').onclick = close;

  $('#eqForm').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = Object.fromEntries(fd.entries());
    try {
      if (isEdit) await api('/equipment/' + e.id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/equipment', { method: 'POST', body: JSON.stringify(body) });
      toast(isEdit ? '已保存' : '已创建');
      close(); onDone();
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* ============== 用户与权限 ============== */
async function viewUsers(view) {
  view.innerHTML = `
    <div class="page-head">
      <h2>用户与权限</h2>
      <button class="btn" id="btnAddUser">+ 新增用户</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody id="userBody"></tbody>
      </table>
    </div>
    <div class="card" id="roleCard"><h3 style="margin-bottom:10px;font-size:15px">角色权限矩阵</h3><div class="muted">加载中…</div></div>`;

  const [users, { roles, permissions }] = await Promise.all([api('/users'), api('/users/roles')]);
  const permName = Object.fromEntries(permissions.map(p => [p.code, p.name]));

  $('#userBody').innerHTML = users.map(u => `
    <tr>
      <td><b>${esc(u.username)}</b></td>
      <td>${esc(u.display_name)}</td>
      <td><span class="zone-tag">${esc(u.role_name)}</span></td>
      <td>${u.active ? '<span class="badge running">启用</span>' : '<span class="badge standby">停用</span>'}</td>
      <td class="muted">${esc(u.created_at)}</td>
      <td>
        <button class="btn secondary sm" data-edit="${u.id}">编辑/重置密码</button>
        <button class="btn ${u.active ? 'danger' : ''} sm" data-toggle="${u.id}">${u.active ? '停用' : '启用'}</button>
        ${u.username !== state.me.username ? `<button class="btn danger sm" data-deluser="${u.id}" data-name="${esc(u.username)}">删除</button>` : '<span class="muted" style="font-size:12px">当前账号</span>'}
      </td>
    </tr>`).join('');

  $('#roleCard').innerHTML = `<h3 style="margin-bottom:10px;font-size:15px">角色权限矩阵</h3>
    <table><thead><tr><th>权限点</th>${roles.map(r => `<th>${esc(r.name)}</th>`).join('')}</tr></thead>
    <tbody>${permissions.map(p => `
      <tr><td>${esc(p.name)}<div class="muted" style="font-size:11px">${esc(p.code)}</div></td>
      ${roles.map(r => `<td style="text-align:center;font-size:16px">${(r.perms||'').split(',').includes(p.code)?'✅':'—'}</td>`).join('')}
      </tr>`).join('')}
    </tbody></table>`;

  $('#btnAddUser').onclick = () => openUserModal(null, () => location.reload());
  view.querySelectorAll('[data-edit]').forEach(b =>
    b.onclick = () => openUserModal(users.find(u => u.id == b.dataset.edit), () => location.reload()));
  view.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    const u = users.find(x => x.id == b.dataset.toggle);
    try {
      await api('/users/' + u.id, { method: 'PUT', body: JSON.stringify({ active: !u.active }) });
      location.reload();
    } catch (err) { toast(err.message, 'err'); }
  });
  view.querySelectorAll('[data-deluser]').forEach(b => b.onclick = async () => {
    if (!confirm(`确定删除用户 ${b.dataset.name}？`)) return;
    try {
      await api('/users/' + b.dataset.deluser, { method: 'DELETE' });
      toast('已删除'); location.reload();
    } catch (err) { toast(err.message, 'err'); }
  });
}

function openUserModal(u, onDone) {
  const isEdit = !!u;
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal" style="width:460px">
      <h3>${isEdit ? '编辑用户' : '新增用户'}</h3>
      <form id="userForm">
        <div class="form-grid">
          <div class="full"><label>用户名 ${isEdit?'':'*'}</label>
            <input name="username" value="${esc(u?.username||'')}" ${isEdit?'disabled':''} required></div>
          <div class="full"><label>姓名 *</label><input name="displayName" value="${esc(u?.display_name||'')}" required></div>
          <div class="full"><label>角色 *</label>
            <select name="role">
              <option value="admin" ${u?.role_code==='admin'?'selected':''}>管理员</option>
              <option value="manager" ${(!u||u.role_code==='manager')?'selected':''}>设备主管</option>
              <option value="viewer" ${u?.role_code==='viewer'?'selected':''}>只读用户</option>
            </select></div>
          <div class="full"><label>${isEdit?'重置密码（留空则不修改）':'初始密码 *'}</label>
            <input name="password" type="text" ${isEdit?'':'required'} placeholder="至少6位"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="uCancel">取消</button>
          <button type="submit" class="btn">${isEdit?'保存':'创建'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.onclick = ev => ev.target === mask && close();
  $('#uCancel').onclick = close;
  $('#userForm').onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    try {
      if (isEdit) {
        const body = { displayName: f.displayName, role: f.role };
        if (f.password) body.password = f.password;
        await api('/users/' + u.id, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/users', { method: 'POST', body: JSON.stringify(f) });
      }
      toast('已保存'); close(); onDone();
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* ============== 路由 ============== */
async function route() {
  const view = $('#view');
  if (!view) return;
  const hash = location.hash || '#/dashboard';
  const [path, query] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean); // [] / ['equipment'] / ['equipment','3'] / ['users']

  document.querySelectorAll('#menu a').forEach(a =>
    a.classList.toggle('active', hash.startsWith(a.getAttribute('href'))));

  try {
    if (parts[0] === 'dashboard' || !parts.length) {
      if (!can('menu:dashboard')) return viewUsers(view);
      await viewDashboard(view);
    } else if (parts[0] === 'equipment') {
      if (parts[1]) await viewDetail(view, parts[1]);
      else await viewEquipment(view);
    } else if (parts[0] === 'users') {
      if (!can('user:manage')) { view.innerHTML = '<div class="empty">无权访问该页面</div>'; return; }
      await viewUsers(view);
    } else {
      location.hash = '#/dashboard';
    }
  } catch (err) { toast(err.message, 'err'); }
}

/* ============== 启动 ============== */
(async function boot() {
  if (!localStorage.getItem('token') || location.hash.startsWith('#/login')) {
    renderLogin();
  } else {
    try { await renderApp(); }
    catch { renderLogin(); }
  }
})();

window.addEventListener('hashchange', () => { if (state.me) route(); });
