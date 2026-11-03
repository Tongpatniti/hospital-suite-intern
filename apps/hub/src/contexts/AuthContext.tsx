/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState } from 'react';

export interface HubUser {
  id: string;
  person_id: number;
  username: string;
  firstname: string;
  lastname: string;
  role: 'admin' | 'staff';
  permissions: string[];
  department_id?: number | null;
  department_name?: string | null;
  department_name_en?: string | null;
}

interface AuthContextType {
  user: HubUser | null;
  login: (user: HubUser) => void;
  logout: () => void;
  isAuthenticated: boolean;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<HubUser | null>(() => {
    const savedUser = localStorage.getItem('hub_user');
    if (!savedUser) return null;
    try {
      return JSON.parse(savedUser) as HubUser;
    } catch {
      return null;
    }
  });

  const login = (userData: HubUser) => {
    localStorage.setItem('hub_user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('hub_user');
    localStorage.removeItem('hub_sso_token');
    localStorage.removeItem('hub_token');
    setUser(null);
  };

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    return user.permissions.includes('all') || user.permissions.includes(permission);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};