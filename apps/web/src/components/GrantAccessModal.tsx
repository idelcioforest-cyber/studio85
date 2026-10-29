import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, MessageCircle, Check } from 'lucide-react';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { Appointment } from '../lib/types';

interface GrantResult {
  customerName: string;
  email: string;
  temporaryPassword: string;
}

function accessMessage(result: GrantResult): string {
  return [
    `Olá, ${result.customerName.split(' ')[0]}! Seu acesso ao app do Studio 85 foi liberado.`,
    '',
    `Acesse: ${window.location.origin}`,
    `E-mail: ${result.email}`,
    `Senha provisória: ${result.temporaryPassword}`,
    '',
    'No primeiro acesso você cria sua própria senha e completa seus dados.',
  ].join('\n');
}

/**
 * Libera o app para um cliente cadastrado pela equipe (cadastro rápido): associa o e-mail e mostra
 * uma senha provisória uma única vez, pronta para enviar pelo WhatsApp.
 */
export function GrantAccessModal({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<GrantResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEmail('');
    setResult(null);
    setCopied(false);
  }, [appointment?.id]);

  const grant = useMutation({
    mutationFn: () => api<GrantResult>(`/admin/customers/${appointment!.customer!.id}/access`, { method: 'POST', body: { email } }),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  if (!appointment?.customer) return null;

  const phoneDigits = (appointment.customerPhone ?? '').replace(/\D/g, '');
  const waPhone = phoneDigits.length === 10 || phoneDigits.length === 11 ? `55${phoneDigits}` : phoneDigits;

  return (
    <Modal
      open
      onClose={onClose}
      title="Liberar acesso ao app"
      description={`${appointment.customerName} poderá acompanhar os agendamentos e as fotos pelo app.`}
    >
      {!result ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            grant.mutate();
          }}
          className="space-y-4"
        >
          {grant.error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
              {grant.error.message}
            </p>
          )}
          <div>
            <label htmlFor="grant-email" className="label">E-mail do cliente</label>
            <input
              id="grant-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
            <p className="mt-1 text-xs text-ink-muted">
              Vamos gerar uma senha provisória. No primeiro acesso o cliente cria a própria senha e completa CPF e demais dados.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={grant.isPending} className="btn-primary">
              {grant.isPending ? 'Gerando…' : 'Gerar acesso'}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success" role="status">
            Acesso liberado. Esta senha aparece só agora: envie ao cliente.
          </p>
          <dl className="space-y-1.5 rounded-xl bg-subtle p-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">E-mail</dt>
              <dd className="font-semibold text-ink">{result.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Senha provisória</dt>
              <dd className="font-mono text-base font-bold tracking-wider text-ink">{result.temporaryPassword}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(accessMessage(result));
                setCopied(true);
              }}
              className="btn-secondary flex-1"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? 'Mensagem copiada' : 'Copiar mensagem'}
            </button>
            {waPhone && (
              <a
                href={`https://wa.me/${waPhone}?text=${encodeURIComponent(accessMessage(result))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex-1"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Enviar no WhatsApp
              </a>
            )}
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="btn-secondary">Fechar</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
