import api from '@repo/api-client';

// ส่ง person_id ของผู้ใช้ปัจจุบันไปกับทุก request (backend อ่านจาก header x-person-id)
api.interceptors.request.use((config) => {
  const raw = localStorage.getItem('repair_user') ?? sessionStorage.getItem('sso_repair_user');
  if (raw) {
    try {
      const u = JSON.parse(raw) as { id?: string };
      if (u.id) config.headers.set('x-person-id', u.id);
    } catch {
      // ignore
    }
  }
  return config;
});

export function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

export default api;
