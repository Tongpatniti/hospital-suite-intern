import React from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@repo/ui/button';
import { ArrowLeft, BookOpen, LogOut } from 'lucide-react';
import { cn } from '@repo/ui/utils';

const navItems = [
  { label: 'รายการฝึกงาน', icon: <BookOpen size={20} />, path: '/training-items' },
];

const MainLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const hubUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:5179/hub/`
    : '/hub/';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <aside className="w-64 bg-white border-r flex flex-col shrink-0">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-blue-700">Example Module</h1>
          <p className="text-xs text-slate-400 mt-1">โปรเจกต์ฝึกงาน</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <div className="pb-2">
            <a
              href={hubUrl}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              <ArrowLeft size={16} />
              Back to Hub
            </a>
          </div>
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t space-y-2 bg-slate-50/50">
          <div className="px-4 py-2 flex flex-col">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Current User</p>
            <p className="text-sm font-bold text-blue-700 truncate">{user?.username}</p>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50 h-9 transition-all"
            onClick={handleLogout}
          >
            <LogOut size={18} className="mr-3" />
            <span className="text-sm">Logout</span>
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
};

export default MainLayout;
