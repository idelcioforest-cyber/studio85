import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError, errorMessage } from '../lib/api';
import { Modal } from './Modal';
import { LegalDocumentBody, LegalSlug } from './LegalDocument';

type Step = 'login' | 'register' | 'verify';

const emptyRegister = { name: '', email: '', phone: '', cpf: '', password: '', acceptTerms: false };

export function AuthModal() {
  const { authModal, closeAuthModal, login, register, verifyEmail, resendCode } = useAuth();
  const [step, setStep] = useState<Step>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [form, setForm] = useState(emptyRegister);
  const [code, setCode] = useState('');
  const [readingDoc, setReadingDoc] = useState<LegalSlug | null>(null);

  useEffect(() => {
    if (authModal.open) {
      setStep(authModal.mode);
      setError(null);
      setNotice(null);
      setReadingDoc(null);
    }
  }, [authModal.open, authModal.mode]);

  const fieldError = (field: string) => (error instanceof ApiError ? error.fieldError(field) : undefined);

  const run = async (action: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(errorMessage(err)));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      try {
        await login(email.trim(), password);
        setPassword('');
        closeAuthModal();
      } catch (err) {
        // Conta criada mas ainda sem verificação: leva direto para o código
        if (err instanceof ApiError && /não foi ativada/i.test(err.message)) {
          setStep('verify');
          setNotice('Sua conta ainda não foi ativada. Digite o código enviado ao seu e-mail.');
          return;
        }
        throw err;
      }
    });
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const result = await register({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.replace(/\D/g, ''),
        cpf: form.cpf.replace(/\D/g, ''),
        password: form.password,
        acceptTerms: form.acceptTerms,
      });
      setEmail(form.email.trim());
      setPassword(form.password);
      setDevCode(result.devVerificationCode ?? null);
      setNotice(`Enviamos um código de 6 dígitos para ${form.email.trim()}.`);
      setStep('verify');
    });
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await verifyEmail(email, code.trim());
      setCode('');
      setDevCode(null);
      if (password) {
        await login(email, password);
        setPassword('');
        setForm(emptyRegister);
        closeAuthModal();
      } else {
        setNotice('Conta ativada. Entre com seu e-mail e senha.');
        setStep('login');
      }
    });
  };

  const handleResend = () =>
    run(async () => {
      const result = await resendCode(email);
      setDevCode(result.devVerificationCode ?? null);
      setNotice('Enviamos um novo código para o seu e-mail.');
    });

  const titles: Record<Step, { title: string; description: string }> = {
    login: { title: 'Entrar', description: authModal.reason ?? 'Acesse seus agendamentos e sua garagem.' },
    register: {
      title: 'Criar conta',
      description: authModal.reason ?? 'Para agendar pelo app, precisamos de alguns dados.',
    },
    verify: { title: 'Confirme seu e-mail', description: 'Digite o código de 6 dígitos para ativar sua conta.' },
  };

  if (readingDoc) {
    return (
      <Modal
        key={readingDoc}
        open={authModal.open}
        onClose={closeAuthModal}
        title={readingDoc === 'terms_of_use' ? 'Termos de Uso' : 'Política de Privacidade'}
        size="lg"
      >
        <div
          tabIndex={0}
          aria-label="Conteúdo do documento"
          className="max-h-[60vh] overflow-y-auto rounded-xl border border-line p-4"
        >
          <LegalDocumentBody slug={readingDoc} showTitle={false} />
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => setReadingDoc(null)} className="btn-primary">
            Voltar ao cadastro
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      key="form"
      open={authModal.open}
      onClose={closeAuthModal}
      title={titles[step].title}
      description={titles[step].description}
    >
      {step !== 'verify' && (
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1" role="tablist" aria-label="Acesso">
          {(['login', 'register'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={step === s}
              onClick={() => {
                setStep(s);
                setError(null);
                setNotice(null);
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                step === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {s === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p className="mb-4 rounded-xl border border-info/30 bg-info/10 p-3 text-sm text-info" role="status">
          {notice}
        </p>
      )}

      {error && !(error instanceof ApiError && error.fieldErrors.length > 0) && (
        <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error.message}
        </p>
      )}

      {step === 'login' && (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="label">E-mail</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="label">Senha</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
          <p className="text-center text-sm text-ink-muted">
            Ainda não tem conta?{' '}
            <button type="button" onClick={() => setStep('register')} className="font-semibold text-accent-text underline">
              Criar conta
            </button>
          </p>
        </form>
      )}

      {step === 'register' && (
        <form onSubmit={handleRegister} className="space-y-3.5" noValidate>
          <Field id="reg-name" label="Nome completo" error={fieldError('name')}>
            <input
              id="reg-name"
              autoComplete="name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="field"
            />
          </Field>
          <Field id="reg-email" label="E-mail" error={fieldError('email')}>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="field"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field id="reg-phone" label="Celular (WhatsApp)" error={fieldError('phone')}>
              <input
                id="reg-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(51) 99999-9999"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="field"
              />
            </Field>
            <Field id="reg-cpf" label="CPF" error={fieldError('cpf')}>
              <input
                id="reg-cpf"
                inputMode="numeric"
                placeholder="000.000.000-00"
                required
                value={form.cpf}
                onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                className="field"
              />
            </Field>
          </div>
          <Field
            id="reg-password"
            label="Senha"
            hint="Mínimo de 8 caracteres, com letra maiúscula, minúscula, número e símbolo."
            error={fieldError('password')}
          >
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="field"
            />
          </Field>
          <div className="rounded-xl border border-line p-3">
            <p className="text-sm text-ink-muted">
              Antes de criar a conta, leia:{' '}
              <button type="button" onClick={() => setReadingDoc('terms_of_use')} className="font-semibold text-accent-text underline">
                Termos de Uso
              </button>{' '}
              e{' '}
              <button type="button" onClick={() => setReadingDoc('privacy_policy')} className="font-semibold text-accent-text underline">
                Política de Privacidade
              </button>
              .
            </p>
            <label className="mt-2.5 flex items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.acceptTerms}
                onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-line-strong accent-amber-500"
              />
              <span>Li e aceito os Termos de Uso e a Política de Privacidade.</span>
            </label>
            {fieldError('acceptTerms') && (
              <p className="mt-1 text-xs font-medium text-danger">{fieldError('acceptTerms')}</p>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            Usamos seu WhatsApp para confirmar o horário e avisar quando o carro estiver pronto.
          </p>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Criando conta…' : 'Criar conta'}
          </button>
        </form>
      )}

      {step === 'verify' && (
        <form onSubmit={handleVerify} className="space-y-4">
          {devCode && (
            <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>
                Ambiente local: o envio de e-mail está desativado. Seu código é <strong className="font-mono">{devCode}</strong>.
              </span>
            </p>
          )}
          <Field id="verify-code" label="Código de verificação" error={fieldError('code')}>
            <input
              id="verify-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="field text-center font-mono text-lg tracking-[0.4em]"
            />
          </Field>
          <button type="submit" disabled={loading || code.length !== 6} className="btn-primary w-full">
            {loading ? 'Verificando…' : 'Ativar conta'}
          </button>
          <button type="button" onClick={handleResend} disabled={loading} className="btn-secondary w-full">
            Reenviar código
          </button>
        </form>
      )}
    </Modal>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactElement;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {React.cloneElement(children, {
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
