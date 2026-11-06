/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { exchangeSsoToken, getSsoTokenFromUrl } from '@repo/api-client';

interface User {
  id: string;
  username: string;
  role: 'admin' | 'staff';
  permissions: string[];
}

interface AuthContextType {
  user: User | null;
  login: (token: string, user: User) => void;
  loginFromSso: (user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
  loading: boolean;
  hasPermission: (permission: string) => boolean;
}

const STORAGE_KEY = 'repair_user';
const TOKEN_KEY = 'repair_token';

function readStoredUser(): User | null {
  const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(`sso_${STORAGE_KEY}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(readStoredUser);
  const ssoToken = useRef(getSsoTokenFromUrl()).current;
  const [loading, setLoading] = useState(!!ssoToken);

  useEffect(() => {
    if (!ssoToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    exchangeSsoToken(ssoToken, 'repair').then(profile => {
      if (profile) {
        const ssoUser: User = {
          id: String(profile.person_id),
          username: profile.username,
          role: profile.role === 'admin' ? 'admin' : 'staff',
          permissions: profile.permissions || [],
        };
        loginFromSso(ssoUser);
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = (token: string, userData: User) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    setUser(userData);
  };

  const loginFromSso = (userData: User) => {
    sessionStorage.setItem(`sso_${STORAGE_KEY}`, JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(`sso_${STORAGE_KEY}`);
    setUser(null);
  };

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    return user.permissions.includes('all') || user.permissions.includes(permission);
  };

  return (
    <AuthContext.Provider value={{ user, login, loginFromSso, logout, isAuthenticated: !!user, loading, hasPermission }}>
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
