import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import MainLayout from './layouts/MainLayout';
import Login from './pages/Login';
import RepairList from './pages/RepairList';
import RepairCreate from './pages/RepairCreate';
import RepairDetail from './pages/RepairDetail';
import AssetHistory from './pages/AssetHistory';
import AuditLogs from './pages/AuditLogs';
import RepairSettings from './pages/RepairSettings';
import { Toaster } from '@repo/ui/toaster';
import './lib/api'; // ติดตั้ง interceptor ส่ง x-person-id

const ProtectedRoute = ({ children, permission }: { children: React.ReactNode; permission?: string }) => {
  const { isAuthenticated, loading, hasPermission } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-slate-400 font-medium">Checking session...</p>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (permission && !hasPermission(permission)) return <Navigate to="/repairs" />;
  return <>{children}</>;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/repair">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/repairs" />} />
            <Route path="repairs" element={<RepairList />} />
            <Route path="repairs/new" element={<RepairCreate />} />
            <Route path="repairs/:id" element={<RepairDetail />} />
            <Route path="assets" element={<AssetHistory />} />
            <Route path="assets/:id" element={<AssetHistory />} />
            <Route path="audit" element={<ProtectedRoute permission="repair.audit.view"><AuditLogs /></ProtectedRoute>} />
            <Route path="settings" element={<RepairSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
