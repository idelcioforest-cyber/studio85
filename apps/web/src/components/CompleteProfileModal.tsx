import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { Modal } from './Modal';
import { PasswordInput } from './PasswordInput';
import { PasswordRules } from './PasswordRules';

/**
 * Primeiro acesso de cliente cadastrado pela equipe: troca a senha provisória e completa os dados.
 * Não dá para pular: fechar a janela encerra a sessão.
 */
export function CompleteProfileModal() {
  const { user, completeProfile, logout } = useAuth();
  const open = Boolean(user && (user.mustChangePassword || user.profileIncomplete));

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && user) {
      setName(user.name);
      setPhone(user.phone ?? '');
    }
  }, [open, user]);

  if (!open) return null;

  const fieldError = (field: string) => (error instanceof ApiError ? error.fieldError(field) : undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(new Error('A confirmação não é igual à nova senha.'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await completeProfile({
        name: name.trim(),
        phone: phone.replace(/\D/g, ''),
        cpf: cpf.replace(/\D/g, ''),
        newPassword: password,
        acceptTerms,
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Não foi possível salvar.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={logout}
      title="Complete seu cadastro"
      description="Para sua segurança, crie uma senha só sua e confirme seus dados. Fechar esta janela encerra a sessão."
    >
      <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
        {error && !(error instanceof ApiError && error.fieldErrors.length > 0) && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {error.message}
          </p>
        )}
        <Field id="cp-name" label="Nome completo" error={fieldError('name')}>
          <input id="cp-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className="field field-caps" />
        </Field>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field id="cp-phone" label="Celular (WhatsApp)" error={fieldError('phone')}>
            <input id="cp-phone" type="tel" autoComplete="tel-national" required value={phone} onChange={(e) => setPhone(e.target.value)} className="field" />
          </Field>
          <Field id="cp-cpf" label="CPF" error={fieldError('cpf')}>
            <input id="cp-cpf" inputMode="numeric" required value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" className="field" />
          </Field>
        </div>
        <div>
          <Field id="cp-password" label="Nova senha" error={fieldError('newPassword')}>
            <PasswordInput id="cp-password" autoComplete="new-password" required aria-describedby="cp-password-rules" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <PasswordRules id="cp-password-rules" value={password} />
        </div>
        <Field id="cp-confirm" label="Confirme a nova senha">
          <PasswordInput id="cp-confirm" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div>
          <label className="flex items-start gap-2.5 text-sm text-ink">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
            <span>
              Li e aceito os{' '}
              <a href="/termos" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-text underline">
                Termos de Uso
              </a>{' '}
              e a{' '}
              <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-text underline">
                Política de Privacidade
              </a>
              <span className="sr-only"> (abrem em nova aba)</span>.
            </span>
          </label>
          {fieldError('acceptTerms') && <p className="mt-1 text-xs font-medium text-danger">{fieldError('acceptTerms')}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" onClick={logout} className="btn-secondary">Sair</button>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Salvando…' : 'Salvar e continuar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactElement }) {
  const describedBy =
    [children.props['aria-describedby'], hint && !error ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {React.cloneElement(children, { 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
