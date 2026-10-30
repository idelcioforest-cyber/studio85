import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, SESSION_EXPIRED_EVENT } from '../lib/api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  // Cliente cadastrado pela equipe: troca a senha provisória e completa os dados no primeiro acesso
  mustChangePassword?: boolean;
  profileIncomplete?: boolean;
}

export interface RegisterData {
  name: string;
  email: string;
  phone: string;
  cpf: string;
  password: string;
  acceptTerms: boolean;
}

export interface CompleteProfileData {
  name: string;
  phone: string;
  cpf: string;
  newPassword: string;
  acceptTerms: boolean;
}

export type AuthModalMode = 'login' | 'register';

interface AuthModalState {
  open: boolean;
  mode: AuthModalMode;
  reason?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAdmin: boolean;
  isLoggedIn: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  completeProfile: (data: CompleteProfileData) => Promise<void>;
  logout: () => Promise<void>;
  register: (data: RegisterData) => Promise<{ devVerificationCode?: string }>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<{ devVerificationCode?: string }>;
  forgotPassword: (email: string) => Promise<{ devResetCode?: string }>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  authModal: AuthModalState;
  openAuthModal: (mode?: AuthModalMode, reason?: string) => void;
  closeAuthModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Guardamos apenas o perfil para exibir o nome sem piscar a tela; o token fica no cookie HttpOnly
const USER_STORAGE_KEY = 'studio85_user';
const LEGACY_KEYS = ['autowash_user', 'autowash_token', 'studio85_appointments_v1'];

interface MeResponse {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: { role: { name: string } }[];
  mustChangePassword: boolean;
  profileIncomplete: boolean;
}

function readStoredUser(): AuthUser | null {
  try {
    const stored = localStorage.getItem(USER_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(readStoredUser);
  const [authModal, setAuthModal] = useState<AuthModalState>({ open: false, mode: 'login' });

  useEffect(() => {
    try {
      if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      // Armazenamento indisponível (aba anônima, por exemplo): a sessão continua no cookie
    }
  }, [user]);

  const clearSession = useCallback(() => {
    setUser(null);
    queryClient.removeQueries({ queryKey: ['vehicles'] });
    queryClient.removeQueries({ queryKey: ['addresses'] });
    queryClient.removeQueries({ queryKey: ['appointments'] });
    queryClient.removeQueries({ queryKey: ['admin'] });
  }, [queryClient]);

  // Confere a sessão real no servidor ao abrir o app e remove dados antigos de demonstração
  useEffect(() => {
    try {
      LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {
      // ignora
    }

    if (!readStoredUser()) return;
    api<MeResponse>('/auth/me')
      .then((me) =>
        setUser({
          id: me.id,
          name: me.name,
          email: me.email,
          phone: me.phone,
          roles: me.roles.map((r) => r.role.name),
          mustChangePassword: me.mustChangePassword,
          profileIncomplete: me.profileIncomplete,
        }),
      )
      .catch(() => clearSession());
  }, [clearSession]);

  useEffect(() => {
    const onExpired = () => setUser((current) => (current ? null : current));
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    queryClient.removeQueries({ queryKey: ['appointments'] });
    setUser(data.user);
    return data.user;
  };

  const completeProfile = async (data: CompleteProfileData) => {
    const result = await api<{ user: AuthUser }>('/auth/complete-profile', { method: 'POST', body: data });
    setUser(result.user);
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Mesmo com falha de rede, encerra a sessão local
    } finally {
      clearSession();
    }
  };

  const register = (data: RegisterData) =>
    api<{ devVerificationCode?: string }>('/auth/register', { method: 'POST', body: data });

  const verifyEmail = async (email: string, code: string) => {
    await api('/auth/verify-email', { method: 'POST', body: { email, code } });
  };

  const resendCode = (email: string) =>
    api<{ devVerificationCode?: string }>('/auth/resend-code', { method: 'POST', body: { email } });

  const forgotPassword = (email: string) =>
    api<{ devResetCode?: string }>('/auth/forgot-password', { method: 'POST', body: { email } });

  const resetPassword = async (email: string, code: string, newPassword: string) => {
    await api('/auth/reset-password', { method: 'POST', body: { email, code, newPassword } });
  };

  const openAuthModal = (mode: AuthModalMode = 'login', reason?: string) =>
    setAuthModal({ open: true, mode, reason });
  const closeAuthModal = () => setAuthModal((prev) => ({ ...prev, open: false }));

  const isAdmin = Boolean(user?.roles?.includes('ADMIN') || user?.roles?.includes('MANAGER'));
  const isLoggedIn = Boolean(user);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        isLoggedIn,
        login,
        completeProfile,
        logout,
        register,
        verifyEmail,
        resendCode,
        forgotPassword,
        resetPassword,
        authModal,
        openAuthModal,
        closeAuthModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
};
