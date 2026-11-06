import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@repo/ui/button';
import { ArrowLeft, Bell, ClipboardList, History, LogOut, Plus, Settings, ShieldCheck } from 'lucide-react';
import { cn } from '@repo/ui/utils';
import api from '../lib/api';
import { fmtDateTimeTH } from '../lib/format';

interface Notification { notification_id: number; ticket_id: number | null; type: string; title: string; message: string | null; is_read: boolean; created_at: string }

const MainLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasPermission } = useAuth();
  const [notes, setNotes] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [showNotes, setShowNotes] = useState(false);

  const navItems = [
    { label: 'งานซ่อม', icon: <ClipboardList size={20} />, path: '/repairs', exact: true },
    { label: 'แจ้งซ่อม', icon: <Plus size={20} />, path: '/repairs/new', exact: true },
    { label: 'ประวัติรายเครื่อง', icon: <History size={20} />, path: '/assets' },
    ...(hasPermission('repair.audit.view') ? [{ label: 'ประวัติการแก้ไข', icon: <ShieldCheck size={20} />, path: '/audit' }] : []),
    { label: 'ตั้งค่าระบบ', icon: <Settings size={20} />, path: '/settings' },
  ];

  const hubUrl = import.meta.env.DEV ? `http://${window.location.hostname}:5179/hub/` : '/hub/';

  const loadNotes = useCallback(() => {
    api.get('/api/repair-notifications').then((r) => { setNotes(r.data.data); setUnread(r.data.unread); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadNotes();
    const t = setInterval(loadNotes, 60_000);
    return () => clearInterval(t);
  }, [loadNotes]);

  const openNotes = () => {
    setShowNotes((v) => !v);
    if (unread > 0) api.post('/api/repair-notifications/read').then(() => setUnread(0)).catch(() => undefined);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <aside className="w-64 bg-white border-r flex flex-col shrink-0">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-teal-800">ระบบแจ้งซ่อม</h1>
          <p className="text-xs text-slate-400 mt-1">Computer · Medical · General</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <div className="pb-2">
            <a href={hubUrl} className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-lg hover:bg-teal-50 hover:text-teal-800 transition-colors">
              <ArrowLeft size={16} />
              Back to Hub
            </a>
          </div>
          {navItems.map((item) => {
            const p = location.pathname;
            const active = item.exact
              ? p === item.path || (item.path === '/repairs' && /^\/repairs\/\d+/.test(p))
              : p.startsWith(item.path);
            return (
              <Link key={item.path} to={item.path}
                className={cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t space-y-2 bg-slate-50/50">
          <div className="px-4 py-2 flex flex-col">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Current User</p>
            <p className="text-sm font-bold text-teal-800 truncate">{user?.username}</p>
          </div>
          <Button variant="ghost" className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50 h-9 transition-all" onClick={handleLogout}>
            <LogOut size={18} className="mr-3" />
            <span className="text-sm">Logout</span>
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-20 flex justify-end border-b bg-white/90 px-6 py-2 backdrop-blur">
          <div className="relative">
            <button onClick={openNotes} className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100" aria-label="การแจ้งเตือน">
              <Bell size={20} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>
              )}
            </button>
            {showNotes && (
              <div className="absolute right-0 mt-2 max-h-[70vh] w-96 overflow-y-auto rounded-lg border bg-white shadow-lg">
                {notes.length === 0 && <p className="p-4 text-sm text-slate-400">ยังไม่มีการแจ้งเตือน</p>}
                {notes.map((n) => (
                  <button key={n.notification_id}
                    onClick={() => { setShowNotes(false); if (n.ticket_id) navigate(`/repairs/${n.ticket_id}`); }}
                    className={cn('block w-full border-b px-4 py-3 text-left hover:bg-slate-50', n.type.startsWith('SLA') && 'border-l-4 border-l-red-500')}>
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.message && <p className="text-xs text-slate-600">{n.message}</p>}
                    <p className="text-[11px] text-slate-400">{fmtDateTimeTH(n.created_at)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default MainLayout;
