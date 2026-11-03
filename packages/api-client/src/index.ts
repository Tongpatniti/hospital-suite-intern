import axios from 'axios';

// Determine the base URL from environment variables, with a fallback.
// In production, if served from the same server, an empty string or relative path can be used.
const API_URL = (import.meta as any).env?.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_URL,
});

// You can add interceptors for handling tokens, errors, etc. here if needed.
// For example:
// api.interceptors.request.use(config => {
//   const token = localStorage.getItem('token');
//   if (token) {
//     config.headers.Authorization = `Bearer ${token}`;
//   }
//   return config;
// });

// ---------- สลับฐานข้อมูล (Test Database) ----------
// checkbox ใน UI จะเขียน localStorage 'db_target' = 'test' แล้วทุก request
// จะแนบ header X-DB-Target: test ไปด้วย (backend จะสลับ pool ให้เฉพาะ request นั้น)
export const DB_TARGET_KEY = 'db_target';

export function getDbTarget(): 'prod' | 'test' {
  try {
    return localStorage.getItem(DB_TARGET_KEY) === 'test' ? 'test' : 'prod';
  } catch {
    return 'prod';
  }
}

export function setDbTarget(target: 'prod' | 'test'): void {
  try {
    if (target === 'test') localStorage.setItem(DB_TARGET_KEY, 'test');
    else localStorage.removeItem(DB_TARGET_KEY);
  } catch {
    /* ignore */
  }
}

api.interceptors.request.use(config => {
  if (getDbTarget() === 'test') {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>)['X-DB-Target'] = 'test';
  }
  return config;
});

export default api;

// ---------- SSO helpers ----------

export function getSsoTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('sso_token');
}

export function clearSsoTokenFromUrl(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has('sso_token')) {
    url.searchParams.delete('sso_token');
    window.history.replaceState({}, '', url.toString());
  }
}

// Exchange the one-time app token from the URL for a user profile.
// Returns the profile (res.data.data) or null on failure, and cleans the URL.
// Pass `token` explicitly if the URL may have changed since page load.
// `app` identifies the calling app so the backend can enforce its login permission.
export async function exchangeSsoToken(token?: string, app?: string): Promise<any | null> {
  const ssoToken = token ?? getSsoTokenFromUrl();
  if (!ssoToken) return null;
  try {
    const res = await api.post('/api/auth/sso/exchange', { sso_token: ssoToken, app });
    if (res.data?.success) {
      return res.data.data;
    }
    return null;
  } catch (err) {
    console.error('SSO exchange failed:', err);
    return null;
  } finally {
    clearSsoTokenFromUrl();
  }
}
