import { useState, useEffect } from 'react';
import { Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { pageMeta } from '@autowash/shared';
import {
  Sparkles,
  Car,
  MapPin,
  Settings,
  Sun,
  Moon,
  LogIn,
  LogOut,
  CalendarDays,
  ClipboardList,
  Layers,
  ArrowUpDown,
  DollarSign,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { CompleteProfileModal } from './components/CompleteProfileModal';
import { InstallBanner, InstallAppLink } from './components/InstallApp';
import { usePublicSettings } from './lib/queries';
import { whatsappLink, WHATSAPP_DISPLAY, SHOP_ADDRESS, SHOP_MAPS_URL } from './lib/format';
import CatalogPage from './pages/CatalogPage';
import AgendaPage from './pages/AgendaPage';
import VehiclesPage from './pages/VehiclesPage';
import AddressesPage from './pages/AddressesPage';
import AdminPatioPage from './pages/AdminPatioPage';
import AdminAgendaPage from './pages/AdminAgendaPage';
import AdminServicesPage from './pages/AdminServicesPage';
import AdminFinanceiroPage from './pages/AdminFinanceiroPage';
import AdminSettingsPage from './pages/AdminSettingsPage';
import ClientAppointmentsPage from './pages/ClientAppointmentsPage';
import LegalPage from './pages/LegalPage';

const THEME_STORAGE_KEY = 'studio85_theme';

interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}

function readInitialTheme(): boolean {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored) return stored === 'dark';
  } catch {
    // ignora
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Título e descrição da aba acompanham a página (o HTML inicial já vem certo do servidor) */
function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = pageMeta(pathname);
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  }, [pathname]);
  return null;
}

export default function App() {
  const { user, isLoggedIn, isAdmin, logout, openAuthModal } = useAuth();
  const { data: settings } = usePublicSettings();
  const [darkMode, setDarkMode] = useState<boolean>(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, darkMode ? 'dark' : 'light');
    } catch {
      // ignora
    }
  }, [darkMode]);

  let navLinks: NavItem[];
  if (isAdmin) {
    navLinks = [
      { to: '/admin/patio', label: 'Pátio', shortLabel: 'Pátio', icon: ArrowUpDown },
      { to: '/admin/agenda', label: 'Agenda', shortLabel: 'Agenda', icon: CalendarDays },
      { to: '/admin/servicos', label: 'Serviços', shortLabel: 'Serviços', icon: Layers },
      { to: '/admin/financeiro', label: 'Caixa', shortLabel: 'Caixa', icon: DollarSign },
      { to: '/admin/configuracoes', label: 'Configurações', shortLabel: 'Ajustes', icon: Settings },
    ];
  } else if (isLoggedIn) {
    navLinks = [
      { to: '/', label: 'Serviços', shortLabel: 'Serviços', icon: Sparkles },
      { to: '/agenda', label: 'Agendar', shortLabel: 'Agendar', icon: CalendarDays },
      { to: '/meus-agendamentos', label: 'Meus agendamentos', shortLabel: 'Agendados', icon: ClipboardList },
      { to: '/garagem', label: 'Garagem', shortLabel: 'Garagem', icon: Car },
      ...(settings?.telebuscaEnabled
        ? [{ to: '/enderecos', label: 'Endereços', shortLabel: 'Endereços', icon: MapPin }]
        : []),
    ];
  } else {
    navLinks = [
      { to: '/', label: 'Serviços', shortLabel: 'Serviços', icon: Sparkles },
      { to: '/agenda', label: 'Agenda', shortLabel: 'Agenda', icon: CalendarDays },
    ];
  }

  // Áreas do cliente: sem login não mostram nenhum dado, só o convite para entrar
  const clientOnly = (page: JSX.Element) => {
    if (isAdmin) return <Navigate to="/admin/patio" replace />;
    return isLoggedIn ? page : <SignInRequired onSignIn={openAuthModal} />;
  };
  const adminOnly = (page: JSX.Element) => (isAdmin ? page : <Navigate to="/" replace />);

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to={isAdmin ? '/admin/patio' : '/'} className="flex flex-shrink-0 items-center gap-2.5">
            <img src="/logo-480.png" alt="" className="h-9 w-9 object-contain" />
            <div className="leading-tight">
              <span className="block text-base font-extrabold tracking-tight text-ink">Studio 85</span>
              <span className="block text-[11px] font-medium text-ink-muted">
                {isAdmin ? 'Painel de gestão' : 'Estética automotiva'}
              </span>
            </div>
          </Link>

          <nav aria-label="Principal" className="hidden items-center gap-1 lg:flex">
            {navLinks.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    isActive ? 'bg-subtle text-ink' : 'text-ink-muted hover:bg-subtle hover:text-ink'
                  }`
                }
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              aria-label={darkMode ? 'Usar tema claro' : 'Usar tema escuro'}
              className="rounded-lg p-2 text-ink-muted transition hover:bg-subtle hover:text-ink"
            >
              {darkMode ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
            </button>

            {isLoggedIn && user ? (
              <div className="flex items-center gap-1.5 border-l border-line pl-2">
                <span className="hidden max-w-[140px] truncate text-sm font-semibold text-ink sm:block">
                  {user.name.split(' ')[0]}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-ink-muted transition hover:bg-subtle hover:text-ink lg:inline-flex"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sair
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => openAuthModal('login')} className="btn-primary px-3.5 py-2">
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Entrar
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
        <InstallBanner />
        <Routes>
          <Route path="/admin/patio" element={adminOnly(<AdminPatioPage />)} />
          <Route path="/admin/agenda" element={adminOnly(<AdminAgendaPage />)} />
          <Route path="/admin/servicos" element={adminOnly(<AdminServicesPage />)} />
          <Route path="/admin/financeiro" element={adminOnly(<AdminFinanceiroPage />)} />
          <Route path="/admin/configuracoes" element={adminOnly(<AdminSettingsPage />)} />

          <Route path="/" element={isAdmin ? <Navigate to="/admin/patio" replace /> : <CatalogPage />} />
          <Route path="/agenda" element={isAdmin ? <Navigate to="/admin/patio" replace /> : <AgendaPage />} />
          <Route path="/meus-agendamentos" element={clientOnly(<ClientAppointmentsPage />)} />
          <Route path="/garagem" element={clientOnly(<VehiclesPage />)} />
          <Route path="/enderecos" element={clientOnly(<AddressesPage />)} />

          <Route path="/termos" element={<LegalPage slug="terms_of_use" />} />
          <Route path="/privacidade" element={<LegalPage slug="privacy_policy" />} />
          <Route path="/cancelamento" element={<LegalPage slug="cancellation_policy" />} />

          <Route path="*" element={<Navigate to={isAdmin ? '/admin/patio' : '/'} replace />} />
        </Routes>
      </main>

      <nav
        aria-label="Navegação inferior"
        className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch justify-around border-t border-line bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {navLinks.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold transition ${
                isActive ? 'text-accent-text' : 'text-ink-muted hover:text-ink'
              }`
            }
          >
            <item.icon className="h-5 w-5" aria-hidden="true" />
            <span>{item.shortLabel}</span>
          </NavLink>
        ))}
        {isLoggedIn ? (
          <button
            type="button"
            onClick={logout}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-ink-muted"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            <span>Sair</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openAuthModal('login')}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-ink-muted"
          >
            <LogIn className="h-5 w-5" aria-hidden="true" />
            <span>Entrar</span>
          </button>
        )}
      </nav>

      <footer className="border-t border-line bg-surface pb-24 pt-6 text-sm text-ink-muted lg:pb-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p>Studio 85 · Estética automotiva</p>
            <a href={SHOP_MAPS_URL} target="_blank" rel="noopener noreferrer" className="block hover:text-ink">
              {SHOP_ADDRESS}
            </a>
            <nav aria-label="Documentos" className="flex flex-wrap gap-x-4 gap-y-1">
              <Link to="/termos" className="underline hover:text-ink">Termos de Uso</Link>
              <Link to="/privacidade" className="underline hover:text-ink">Privacidade</Link>
              <Link to="/cancelamento" className="underline hover:text-ink">Cancelamento</Link>
            </nav>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <a
              href={whatsappLink('Olá! Gostaria de falar com o Studio 85.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-ink hover:text-accent-text"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              WhatsApp {WHATSAPP_DISPLAY}
            </a>
            <InstallAppLink />
          </div>
        </div>
      </footer>

      <RouteMeta />
      <AuthModal />
      <CompleteProfileModal />
    </div>
  );
}

function SignInRequired({ onSignIn }: { onSignIn: (mode?: 'login' | 'register', reason?: string) => void }) {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-bold text-ink">Entre na sua conta</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Esta área mostra seus agendamentos e veículos. Entre ou crie uma conta para continuar.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button type="button" onClick={() => onSignIn('login')} className="btn-primary">
          Entrar
        </button>
        <button type="button" onClick={() => onSignIn('register')} className="btn-secondary">
          Criar conta
        </button>
      </div>
    </div>
  );
}
