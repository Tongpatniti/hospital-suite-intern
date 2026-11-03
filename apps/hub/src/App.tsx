import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  BookOpen,
  LogOut,
  Loader2,
  Key,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/card';
import { Button } from '@repo/ui/button';
import { ChangePasswordDialog } from '@repo/ui/change-password-dialog';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import api from '@repo/api-client';

const iconMap: Record<string, LucideIcon> = {
  BookOpen,
};

interface AppEntry {
  name: string;
  url: string;
  icon: string;
  description: string;
  color: string;
  permission?: string;
  external?: boolean;
}

// ---------------------------------------------------------------------------
// ลงทะเบียนแอปของนักศึกษาที่นี่ — 1 การ์ด = 1 แอปใน apps/
// url ต้องตรงกับ base ใน vite.config.ts ของแอปนั้น และ permission ต้องตรงกับ
// APP_PERMISSION ใน apps/backend/src/auth.ts
// ---------------------------------------------------------------------------
const apps: AppEntry[] = [
  {
    name: 'Example Module',
    url: import.meta.env.DEV
      ? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:5180/example/`
      : '/example/',
    icon: 'BookOpen',
    description: 'โมดูลตัวอย่างสำหรับฝึกงาน — CRUD ครบวงจร ใช้เป็นแม่แบบ',
    color: 'bg-sky-500',
    permission: 'training.login',
  },
];

function HubHome() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [launching, setLaunching] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', handler as EventListener);
    return () => window.removeEventListener('pageshow', handler as EventListener);
  }, []);

  const canAccessApp = (app: AppEntry): boolean => {
    if (!app.permission) return true;
    return hasPermission(app.permission);
  };

  const handleLaunch = async (app: AppEntry) => {
    if (app.external) {
      window.location.href = app.url;
      return;
    }
    setLaunching(app.name);
    try {
      const ssoToken = localStorage.getItem('hub_sso_token');
      let target = app.url;
      if (ssoToken) {
        const res = await api.post('/api/auth/sso/issue', { sso_token: ssoToken });
        if (res.data?.success && res.data.sso_token) {
          target = `${app.url}${app.url.includes('?') ? '&' : '?'}sso_token=${res.data.sso_token}`;
        }
      }
      window.location.href = target;
    } catch {
      window.location.href = app.url;
    } finally {
      setLaunching(null);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleChangePassword = async (currentPassword: string, newPassword: string) => {
    try {
      const response = await api.post('/api/auth/change-password', {
        username: user?.username,
        currentPassword,
        newPassword,
      });
      return response.data;
    } catch (err) {
      return (
        (err as { response?: { data?: { success: boolean; message: string } } }).response?.data || {
          success: false,
          message: 'Failed to connect to server',
        }
      );
    }
  };

  const visibleApps = apps.filter(canAccessApp);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-white font-bold">
              {user?.firstname?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase()}
            </div>
            <div className="text-sm">
              <p className="font-bold text-slate-800 leading-tight">
                {user?.firstname} {user?.lastname}
              </p>
              <p className="text-xs text-slate-400 leading-tight">{user?.department_name || '-'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ChangePasswordDialog
              username={user?.username || ''}
              onConfirm={handleChangePassword}
              trigger={
                <Button variant="outline" size="sm" className="font-semibold text-slate-600">
                  <Key className="mr-2 h-4 w-4" />
                  เปลี่ยนรหัส
                </Button>
              }
            />
            <Button variant="outline" size="sm" onClick={handleLogout} className="font-semibold text-slate-600">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">Hospital Suite (Intern)</h1>
          <p className="text-slate-500">Select an application to get started</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleApps.map((app) => {
            const Icon = iconMap[app.icon];
            const isLaunching = launching === app.name;
            return (
              <div key={app.name} onClick={() => handleLaunch(app)} className="group block cursor-pointer">
                <Card className="h-full transition-all duration-200 hover:shadow-md hover:border-slate-300 cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      {Icon && (
                        <div className={`w-10 h-10 rounded-lg ${app.color} flex items-center justify-center text-white`}>
                          {isLaunching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
                        </div>
                      )}
                      <CardTitle className="text-lg">{app.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{app.description}</p>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EntryGate() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Login />;
  return <HubHome />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<EntryGate />} />
      <Route path="/login" element={<EntryGate />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/hub">
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
