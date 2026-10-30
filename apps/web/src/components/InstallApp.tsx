import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Modal } from './Modal';

/**
 * "Instalar o app" (PWA): no Android/Chrome usa o convite nativo do navegador;
 * no iPhone/iPad, que não tem esse convite, mostra o passo a passo do Safari.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'studio85_install_dismissed_at';
const DISMISS_DAYS = 14;

// O navegador dispara o convite uma vez, logo no carregamento: guardamos fora do React
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS se apresenta como Mac, mas tem toque
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export function useInstallApp() {
  const prompt = useSyncExternalStore(subscribe, () => deferredPrompt);
  const done = useSyncExternalStore(subscribe, () => installed);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);

  const standalone = typeof window !== 'undefined' && isStandalone();
  const ios = typeof window !== 'undefined' && isIOS();
  const available = !standalone && !done && (Boolean(prompt) || ios);

  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice;
      deferredPrompt = null;
      notify();
    } else if (ios) {
      setIosHelpOpen(true);
    }
  };

  return { available, install, iosHelpOpen, closeIosHelp: () => setIosHelpOpen(false) };
}

function IosInstallHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Instalar no iPhone" description="Leva menos de 10 segundos, pelo Safari.">
      <ol className="space-y-3">
        <li className="flex items-start gap-3 rounded-xl border border-line p-3">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">1</span>
          <p className="text-sm text-ink">
            Toque em <strong className="font-semibold">Compartilhar</strong>{' '}
            <Share className="inline h-4 w-4 align-text-bottom text-info" aria-label="(ícone de quadrado com seta para cima)" />{' '}
            na barra do Safari.
          </p>
        </li>
        <li className="flex items-start gap-3 rounded-xl border border-line p-3">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">2</span>
          <p className="text-sm text-ink">
            Role e escolha <strong className="font-semibold">Adicionar à Tela de Início</strong>{' '}
            <SquarePlus className="inline h-4 w-4 align-text-bottom" aria-hidden="true" />.
          </p>
        </li>
        <li className="flex items-start gap-3 rounded-xl border border-line p-3">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">3</span>
          <p className="text-sm text-ink">
            Toque em <strong className="font-semibold">Adicionar</strong>. O ícone do Studio 85 aparece na sua tela inicial.
          </p>
        </li>
      </ol>
      <p className="mt-3 text-xs text-ink-muted">Se estiver em outro navegador, abra o site no Safari para ver essa opção.</p>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="btn-primary">
          Entendi
        </button>
      </div>
    </Modal>
  );
}

/** Faixa no topo das páginas: some ao instalar ou ao dispensar (volta depois de 14 dias) */
export function InstallBanner() {
  const { available, install, iosHelpOpen, closeIosHelp } = useInstallApp();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
      setDismissed(Date.now() - at < DISMISS_DAYS * 86_400_000);
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // sem armazenamento: some só nesta visita
    }
  };

  return (
    <>
      {available && !dismissed && (
        <aside aria-label="Instalar o app" className="card mb-6 flex items-center gap-3 p-3 sm:p-4">
          <img src="/apple-touch-icon.png" alt="" className="h-12 w-12 flex-shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">Instale o app do Studio 85</p>
            <p className="text-xs text-ink-muted">Agende e acompanhe seu carro direto da tela inicial.</p>
          </div>
          <button type="button" onClick={install} className="btn-primary flex-shrink-0 px-3 py-2">
            <Download className="h-4 w-4" aria-hidden="true" />
            Instalar
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Agora não"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-subtle hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </aside>
      )}
      <IosInstallHelp open={iosHelpOpen} onClose={closeIosHelp} />
    </>
  );
}

/** Link discreto no rodapé, sempre disponível enquanto o app não estiver instalado */
export function InstallAppLink() {
  const { available, install, iosHelpOpen, closeIosHelp } = useInstallApp();
  if (!available) return null;
  return (
    <>
      <button type="button" onClick={install} className="inline-flex items-center gap-1.5 font-semibold text-ink hover:text-accent-text">
        <Download className="h-4 w-4" aria-hidden="true" />
        Instalar o app
      </button>
      <IosInstallHelp open={iosHelpOpen} onClose={closeIosHelp} />
    </>
  );
}
