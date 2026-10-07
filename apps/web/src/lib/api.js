const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// The access token lives in memory only (not localStorage) to limit XSS exposure.
// The refresh token is an httpOnly cookie managed by the API.
let accessToken = null;
let refreshing = null;
export const setToken = (t) => { accessToken = t; };

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

async function raw(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(`${BASE}/api${path}`, { method, headers, credentials: 'include', body: form ?? (body ? JSON.stringify(body) : undefined) });
}

export async function refreshSession() {
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return null;
      const j = await r.json();
      accessToken = j.data.accessToken;
      return j.data;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api(path, opts = {}) {
  let res = await raw(path, opts);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const s = await refreshSession();
    if (s) res = await raw(path, opts);
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.details?.[0]?.message ? `${e.message}: ${e.details[0].message}` : (e.message || 'Something went wrong'), e.details);
  }
  return json;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
export const postForm = (p, form) => api(p, { method: 'POST', form });

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
