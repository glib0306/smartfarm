// REST client for the CPS backend (same origin in production, CRA proxy in development).
const BASE = process.env.REACT_APP_API || '';

export function getToken() {
  try { return localStorage.getItem('cps_token') || ''; } catch (e) { return ''; }
}

export function setToken(t) {
  try { if (t) localStorage.setItem('cps_token', t); else localStorage.removeItem('cps_token'); } catch (e) { /* ignore */ }
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + '/api' + path, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.status === 401 && path.indexOf('/auth/login') < 0) {
    setToken('');
    window.dispatchEvent(new Event('cps-logout'));
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
    err.status = res.status;
    err.warning = !!(data && data.warning);
    throw err;
  }
  return data;
}

export const post = (path, body) => api(path, { method: 'POST', body: body || {} });
export const put = (path, body) => api(path, { method: 'PUT', body: body || {} });
export const del = (path) => api(path, { method: 'DELETE' });
