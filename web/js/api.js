// 后端 API 封装（token 存 localStorage）
const API = (() => {
  const TOKEN_KEY = 'coldstore_token';
  const USER_KEY = 'coldstore_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
  function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }

  async function request(method, url, { body, isForm } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload;
    if (isForm) { payload = body; }                       // FormData：让浏览器自动带 Content-Type
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

    const resp = await fetch(url, { method, headers, body: payload });
    if (resp.status === 401) { clear(); location.hash = '#/login'; throw new Error('登录已过期，请重新登录'); }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败 (${resp.status})`);
    return data;
  }

  return {
    getToken, setSession, clear, getUser,
    login: (username, password) => request('POST', '/api/auth/login', { body: { username, password } }),
    me: () => request('GET', '/api/auth/me'),
    listEquipment: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request('GET', '/api/equipment?' + qs);
    },
    getEquipment: (id) => request('GET', '/api/equipment/' + id),
    createEquipment: (d) => request('POST', '/api/equipment', { body: d }),
    updateEquipment: (id, d) => request('PUT', '/api/equipment/' + id, { body: d }),
    deleteEquipment: (id) => request('DELETE', '/api/equipment/' + id),
    uploadManual: (id, file) => {
      const fd = new FormData();
      fd.append('file', file);
      return request('POST', `/api/equipment/${id}/manuals`, { body: fd, isForm: true });
    },
    downloadUrl: (id, fileId) => `/api/equipment/${id}/manuals/${fileId}/download`,
    deleteManual: (id, fileId) => request('DELETE', `/api/equipment/${id}/manuals/${fileId}`),
  };
})();
