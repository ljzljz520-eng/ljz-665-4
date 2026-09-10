'use strict';
// 轻量 fetch 封装
const Api = {
  async req(method, url, body, isForm) {
    const opts = {
      method,
      headers: {},
      credentials: 'same-origin'
    };
    if (body && !isForm) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body && isForm) {
      opts.body = body; // FormData，浏览器自动设置 multipart 边界
    }
    const resp = await fetch(url, opts);
    let json = null;
    try { json = await resp.json(); } catch (_) { /* 非 json */ }
    if (!resp.ok) {
      const err = new Error((json && json.error) || `请求失败 (${resp.status})`);
      err.status = resp.status;
      throw err;
    }
    return json ? json.data : null;
  },
  get(u)        { return this.req('GET', u); },
  post(u, b)    { return this.req('POST', u, b); },
  put(u, b)     { return this.req('PUT', u, b); },
  del(u)        { return this.req('DELETE', u); },
  upload(u, fd) { return this.req('POST', u, fd, true); }
};
