// 冷库设备档案 SPA（hash 路由：#/login #/equipment #/equipment/:id）
const ZONE_LABEL = { deep_freezer: '深冷区(≤-30℃)', freezer: '冷冻区(-18~-30℃)', chilled: '冷藏区(0~10℃)', constant: '恒温区' };
const STATUS_LABEL = { running: '运行', standby: '备用', fault: '故障', maintenance: '维保中', stopped: '停用' };
const ROLE_LABEL = { admin: '系统管理员', manager: '设备主管', operator: '运维员' };

const state = { me: null, filter: { temp_zone: '', status: '', keyword: '' }, page: 1, meta: { tempZones: [], statuses: [] } };
const app = document.getElementById('app');

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show ' + type;
  clearTimeout(el._t); el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtSize(n) { return n > 1024 * 1024 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
function can(p) { return state.me?.permissions?.[p]; }

async function boot() {
  if (!API.getToken()) { location.hash = '#/login'; return; }
  try { state.me = await API.me(); } catch { location.hash = '#/login'; return; }
  route();
}

window.addEventListener('hashchange', route);

function route() {
  if (!API.getToken()) return renderLogin();
  const h = location.hash || '#/equipment';
  const m = h.match(/^#\/equipment\/(\d+)$/);
  if (h === '#/login') return renderLogin(false);
  if (h === '#/permissions') return renderLayout(renderPermissions);
  if (m) return renderLayout(() => renderDetail(Number(m[1])));
  return renderLayout(renderList);
}

/* ---------- 登录页 ---------- */
function renderLogin(force = true) {
  if (force && API.getToken()) { location.hash = '#/equipment'; return; }
  app.innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <h1>🧊 冷库设备档案管理系统</h1>
    <div class="sub">Cold Storage Equipment Archive</div>
    <div class="form-grid" style="grid-template-columns:1fr">
      <div><label>账号</label><input id="li-user" placeholder="请输入账号" value="admin"></div>
      <div><label>密码</label><input id="li-pass" type="password" placeholder="请输入密码" value="admin123"></div>
    </div>
    <div style="margin-top:16px"><button id="li-btn" style="width:100%">登 录</button></div>
    <div class="demo">
      <b>演示账号</b>（角色权限不同）：<br>
      admin / admin123 （全部权限）<br>
      manager / manager123 （可编辑、不可删除）<br>
      operator / operator123 （仅查看 + 上传说明书）
    </div>
  </div></div>`;
  const doLogin = async () => {
    const btn = document.getElementById('li-btn');
    btn.disabled = true;
    try {
      const { token, user } = await API.login(
        document.getElementById('li-user').value.trim(),
        document.getElementById('li-pass').value);
      API.setSession(token, user);
      location.hash = '#/equipment';
      await boot();
    } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
  };
  document.getElementById('li-btn').onclick = doLogin;
  document.getElementById('li-pass').onkeydown = e => e.key === 'Enter' && doLogin();
}

/* ---------- 整体布局 + 菜单 ---------- */
function renderLayout(viewFn) {
  const u = state.me;
  app.innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">🧊 冷库设备档案<small>Cold Storage Archive</small></div>
      <ul class="menu">
        <li data-menu="equipment" class="${location.hash.startsWith('#/equipment') ? 'active' : ''}">📋 设备档案</li>
        <li data-menu="permissions" class="${location.hash === '#/permissions' ? 'active' : ''}">🔑 权限说明</li>
      </ul>
      <div class="userbox">
        <div class="name">${esc(u.displayName)}<span class="role-tag">${ROLE_LABEL[u.role]}</span></div>
        <a id="logout">退出登录</a>
      </div>
    </aside>
    <main class="main" id="view"></main>
  </div>`;
  document.querySelector('[data-menu=equipment]').onclick = () => { location.hash = '#/equipment'; };
  document.querySelector('[data-menu=permissions]').onclick = () => { location.hash = '#/permissions'; };
  document.getElementById('logout').onclick = () => { API.clear(); location.hash = '#/login'; renderLogin(); };
  viewFn(document.getElementById('view'));
}

/* ---------- 设备列表 + 筛选 ---------- */
async function renderList(el) {
  el.innerHTML = `
    <div class="page-head"><h2>设备档案</h2>
      ${can('equipmentCreate') ? '<button id="btn-add">＋ 新增设备</button>' : ''}
    </div>
    <div class="card">
      <div class="filter-bar">
        <div class="field"><label>温区</label>
          <select id="f-zone"><option value="">全部温区</option>
            ${Object.entries(ZONE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>运行状态</label>
          <select id="f-status"><option value="">全部状态</option>
            ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>关键字</label><input id="f-kw" placeholder="编号/名称/位置/负责人"></div>
        <button id="f-search">查询</button>
        <button class="ghost" id="f-reset">重置</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table><thead><tr>
        <th>设备编号</th><th>设备名称</th><th>温区</th><th>安装位置</th><th>负责人</th><th>最近维保</th><th>运行状态</th><th>操作</th>
      </tr></thead><tbody id="eq-tbody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody></table>
      <div class="pager" id="pager"></div>
    </div>`;

  document.getElementById('f-zone').value = state.filter.temp_zone;
  document.getElementById('f-status').value = state.filter.status;
  document.getElementById('f-kw').value = state.filter.keyword;
  document.getElementById('f-search').onclick = () => {
    state.filter = {
      temp_zone: document.getElementById('f-zone').value,
      status: document.getElementById('f-status').value,
      keyword: document.getElementById('f-kw').value.trim(),
    };
    state.page = 1; loadList();
  };
  document.getElementById('f-reset').onclick = () => {
    state.filter = { temp_zone: '', status: '', keyword: '' }; state.page = 1;
    document.getElementById('f-zone').value = ''; document.getElementById('f-status').value = '';
    document.getElementById('f-kw').value = ''; loadList();
  };
  if (can('equipmentCreate')) document.getElementById('btn-add').onclick = () => openEditModal(null);
  loadList();

  async function loadList() {
    const tbody = document.getElementById('eq-tbody');
    try {
      const { total, page, pageSize, list } = await API.listEquipment({ ...state.filter, page: state.page });
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty">没有符合条件的设备</td></tr>';
      } else {
        tbody.innerHTML = list.map(e => `
          <tr class="clickable" data-id="${e.id}">
            <td class="code-link">${esc(e.code)}</td>
            <td>${esc(e.name)}</td>
            <td><span class="badge zone">${ZONE_LABEL[e.temp_zone]}</span></td>
            <td>${esc(e.location)}</td>
            <td>${esc(e.owner)}</td>
            <td>${e.last_maintenance ? esc(e.last_maintenance) : '<span class="muted">—</span>'}</td>
            <td><span class="badge ${e.status}">${STATUS_LABEL[e.status]}</span></td>
            <td><button class="sm ghost" data-view="${e.id}">详情</button></td>
          </tr>`).join('');
        tbody.querySelectorAll('tr').forEach(tr => tr.onclick = () => { location.hash = '#/equipment/' + tr.dataset.id; });
      }
      const pages = Math.max(1, Math.ceil(total / pageSize));
      document.getElementById('pager').innerHTML =
        `<span>共 ${total} 条，第 ${page}/${pages} 页</span>
         <button class="sm ghost" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
         <button class="sm ghost" id="pg-next" ${page >= pages ? 'disabled' : ''}>下一页</button>`;
      document.getElementById('pg-prev')?.addEventListener('click', () => { state.page--; loadList(); });
      document.getElementById('pg-next')?.addEventListener('click', () => { state.page++; loadList(); });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">加载失败：${esc(e.message)}</td></tr>`;
    }
  }
}

/* ---------- 设备详情 + 说明书上传 ---------- */
async function renderDetail(id) {
  const el = document.getElementById('view');
  el.innerHTML = '<div class="empty">加载中…</div>';
  let e;
  try { e = await API.getEquipment(id); } catch (err) { el.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  el.innerHTML = `
    <a class="back-link" id="back">← 返回设备列表（保留筛选）</a>
    <div class="page-head"><h2>${esc(e.name)} <span class="muted" style="font-size:13px">${esc(e.code)}</span></h2>
      <div style="display:flex;gap:8px">
        ${can('equipmentEdit') ? '<button id="btn-edit">编辑档案</button>' : ''}
        ${can('equipmentDelete') ? '<button class="danger" id="btn-del">删除</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="section-title">基本信息</div>
      <div class="detail-grid">
        <div class="item"><label>设备编号</label><span>${esc(e.code)}</span></div>
        <div class="item"><label>设备名称</label><span>${esc(e.name)}</span></div>
        <div class="item"><label>温区</label><span><span class="badge zone">${ZONE_LABEL[e.temp_zone]}</span></span></div>
        <div class="item"><label>运行状态</label><span><span class="badge ${e.status}">${STATUS_LABEL[e.status]}</span></span></div>
        <div class="item"><label>安装位置</label><span>${esc(e.location)}</span></div>
        <div class="item"><label>负责人</label><span>${esc(e.owner)}</span></div>
        <div class="item"><label>最近维保日期</label><span>${e.last_maintenance ? esc(e.last_maintenance) : '—'}</span></div>
        <div class="item"><label>建档时间</label><span>${esc(e.created_at)}</span></div>
        <div class="item" style="grid-column:1/-1"><label>备注</label><span>${e.remark ? esc(e.remark) : '—'}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="section-title">设备说明书 / 资料（${e.manuals.length}）</div>
      ${can('manualUpload') ? `
      <div class="upload-box">
        <input type="file" id="manual-file">
        <button class="sm" id="manual-upload">上传说明书</button>
        <div class="meta" style="margin-top:6px">支持 pdf / doc / xls / 图片 / zip，单个文件 ≤ 20MB</div>
      </div>` : '<p class="muted" style="margin-bottom:10px">当前角色无上传权限</p>'}
      <div id="manual-list">${renderManuals(e)}</div>
    </div>`;

  document.getElementById('back').onclick = () => { location.hash = '#/equipment'; };
  if (can('equipmentEdit')) document.getElementById('btn-edit').onclick = () => openEditModal(e);
  if (can('equipmentDelete')) document.getElementById('btn-del').onclick = async () => {
    if (!confirm(`确认删除设备 ${e.code}（${e.name}）及其全部说明书？此操作不可恢复。`)) return;
    try { await API.deleteEquipment(e.id); toast('已删除', 'ok'); location.hash = '#/equipment'; }
    catch (err) { toast(err.message, 'error'); }
  };
  if (can('manualUpload')) document.getElementById('manual-upload').onclick = async () => {
    const f = document.getElementById('manual-file').files[0];
    if (!f) return toast('请先选择文件', 'error');
    if (f.size > 20 * 1048576) return toast('文件超过 20MB', 'error');
    const btn = document.getElementById('manual-upload'); btn.disabled = true;
    try { await API.uploadManual(e.id, f); toast('上传成功', 'ok'); const fresh = await API.getEquipment(e.id);
      document.getElementById('manual-list').innerHTML = renderManuals(fresh);
      document.getElementById('manual-file').value = '';
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  };
  bindManualActions(e);
}

function renderManuals(e) {
  if (!e.manuals.length) return '<div class="empty">暂无说明书资料</div>';
  return e.manuals.map(m => `
    <div class="file-row" data-fid="${m.id}">
      <div>
        <div>📄 ${esc(m.original_name)}</div>
        <div class="meta">${fmtSize(m.size)} · ${esc(m.uploaded_by_name || '')} 上传于 ${esc(m.uploaded_at)}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="sm ghost" data-dl="${m.id}">下载</button>
        ${can('manualDelete') ? `<button class="sm danger" data-del="${m.id}">删除</button>` : ''}
      </div>
    </div>`).join('');
}

function bindManualActions(e) {
  document.querySelectorAll('#manual-list [data-dl]').forEach(btn => btn.onclick = async () => {
    // 带 JWT 头下载为 Blob，避免直接暴露带 token 的 URL
    const resp = await fetch(API.downloadUrl(e.id, btn.dataset.dl), { headers: { Authorization: 'Bearer ' + API.getToken() } });
    if (!resp.ok) return toast('下载失败', 'error');
    const cd = resp.headers.get('Content-Disposition') || '';
    const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const plain = cd.match(/filename="?([^";]+)"?/i);
    const name = star ? decodeURIComponent(star[1]) : (plain ? plain[1] : 'manual');
    const blob = await resp.blob(); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  });
  if (can('manualDelete')) document.querySelectorAll('#manual-list [data-del]').forEach(btn => btn.onclick = async () => {
    if (!confirm('确认删除该说明书文件？')) return;
    try { await API.deleteManual(e.id, btn.dataset.del); toast('已删除', 'ok');
      const fresh = await API.getEquipment(e.id);
      document.getElementById('manual-list').innerHTML = renderManuals(fresh); bindManualActions(fresh);
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------- 新增/编辑模态框 ---------- */
function openEditModal(e) {
  const isEdit = !!e;
  const d = e || { code: '', name: '', temp_zone: 'freezer', location: '', owner: '', last_maintenance: '', status: 'running', remark: '' };
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
  <div class="modal">
    <h3>${isEdit ? '编辑设备档案' : '新增设备档案'}</h3>
    <div class="form-grid">
      <div><label>设备编号 *</label><input id="ef-code" value="${esc(d.code)}" ${isEdit ? '' : ''}></div>
      <div><label>设备名称 *</label><input id="ef-name" value="${esc(d.name)}"></div>
      <div><label>温区 *</label><select id="ef-zone">
        ${Object.entries(ZONE_LABEL).map(([k, v]) => `<option value="${k}" ${d.temp_zone === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></div>
      <div><label>运行状态 *</label><select id="ef-status">
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></div>
      <div><label>安装位置 *</label><input id="ef-location" value="${esc(d.location)}"></div>
      <div><label>负责人 *</label><input id="ef-owner" value="${esc(d.owner)}"></div>
      <div><label>最近维保日期</label><input type="date" id="ef-maint" value="${esc(d.last_maintenance || '')}"></div>
      <div><label>&nbsp;</label></div>
      <div class="full"><label>备注</label><textarea id="ef-remark" rows="3">${esc(d.remark || '')}</textarea></div>
    </div>
    <div class="modal-foot">
      <button class="ghost" id="ef-cancel">取消</button>
      <button id="ef-save">保存</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('click', ev => { if (ev.target === mask) close(); });
  document.getElementById('ef-cancel').onclick = close;
  document.getElementById('ef-save').onclick = async () => {
    const payload = {
      code: document.getElementById('ef-code').value.trim(),
      name: document.getElementById('ef-name').value.trim(),
      temp_zone: document.getElementById('ef-zone').value,
      location: document.getElementById('ef-location').value.trim(),
      owner: document.getElementById('ef-owner').value.trim(),
      last_maintenance: document.getElementById('ef-maint').value,
      status: document.getElementById('ef-status').value,
      remark: document.getElementById('ef-remark').value.trim(),
    };
    try {
      if (isEdit) await API.updateEquipment(e.id, payload); else await API.createEquipment(payload);
      toast('保存成功', 'ok'); close();
      if (location.hash.match(/^#\/equipment\/\d+$/)) { const id = isEdit ? e.id : null; if (id) { renderDetail(id); } else route(); }
      else route();
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- 权限说明页（菜单可见性也由 /me.permissions 驱动） ---------- */
function renderPermissions(el) {
  el.innerHTML = `
  <div class="page-head"><h2>权限说明</h2></div>
  <div class="card" style="padding:0">
    <table>
      <thead><tr><th>功能 / 角色</th><th>系统管理员 admin</th><th>设备主管 manager</th><th>运维员 operator</th></tr></thead>
      <tbody>
        <tr><td>查看设备档案、按温区/状态筛选</td><td>✔</td><td>✔</td><td>✔</td></tr>
        <tr><td>查看设备详情、下载说明书</td><td>✔</td><td>✔</td><td>✔</td></tr>
        <tr><td>新增 / 编辑设备档案</td><td>✔</td><td>✔</td><td>—</td></tr>
        <tr><td>上传设备说明书</td><td>✔</td><td>✔</td><td>✔</td></tr>
        <tr><td>删除说明书</td><td>✔</td><td>✔</td><td>—</td></tr>
        <tr><td>删除设备档案</td><td>✔</td><td>—</td><td>—</td></tr>
        <tr><td>用户与账号管理</td><td>✔</td><td>—</td><td>—</td></tr>
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="section-title">当前账号</div>
    <p>登录身份：<b>${esc(state.me.displayName)}</b>（${state.me.username}），角色：<b>${ROLE_LABEL[state.me.role]}</b></p>
    <p class="muted" style="margin-top:6px">菜单与按钮在前端依据 <code>/api/auth/me</code> 返回的 permissions 渲染；后端接口对每个写操作独立鉴权，绕过前端同样会被拒绝（403）。</p>
  </div>`;
}

boot();
