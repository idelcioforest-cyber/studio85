import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Save } from 'lucide-react';
import { api } from '../lib/api';
import { WhatsAppSettings } from '../components/WhatsAppSettings';

interface AdminSettings {
  companyName: string;
  phone: string | null;
  telebuscaEnabled: boolean;
  telebuscaFeeCents: number;
  cancellationLimitHours: number;
}

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api<AdminSettings>('/settings/admin'),
  });

  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [telebuscaEnabled, setTelebuscaEnabled] = useState(false);
  const [telebuscaFee, setTelebuscaFee] = useState('0,00');
  const [cancellationHours, setCancellationHours] = useState('4');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setCompanyName(data.companyName);
    setPhone(data.phone ?? '');
    setTelebuscaEnabled(data.telebuscaEnabled);
    setTelebuscaFee((data.telebuscaFeeCents / 100).toFixed(2).replace('.', ','));
    setCancellationHours(String(data.cancellationLimitHours));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings/admin', {
        method: 'PATCH',
        body: {
          companyName: companyName.trim(),
          phone: phone.replace(/\D/g, '') || null,
          telebuscaEnabled,
          telebuscaFeeCents: Math.round(parseFloat(telebuscaFee.replace(',', '.') || '0') * 100),
          cancellationLimitHours: Number(cancellationHours) || 4,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'public'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="animate-fadeIn mx-auto max-w-3xl space-y-6">
      <header>
        <p className="eyebrow">Configuração</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Configurações</h1>
        <p className="mt-1 text-sm text-ink-muted">Dados do estabelecimento, Telebusca e regra de cancelamento.</p>
      </header>

      {saved && (
        <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-semibold text-success" role="status">
          <Check className="h-4 w-4" aria-hidden="true" />
          Configurações salvas.
        </p>
      )}
      {save.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {save.error.message}
        </p>
      )}
      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar as configurações.
        </p>
      )}

      {data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5"
        >
          <section className="card space-y-4 p-5" aria-labelledby="sec-empresa">
            <h2 id="sec-empresa" className="font-bold text-ink">Estabelecimento</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="set-name" className="label">Nome comercial</label>
                <input id="set-name" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="field" />
              </div>
              <div>
                <label htmlFor="set-phone" className="label">Telefone / WhatsApp</label>
                <input id="set-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="field" />
              </div>
            </div>
          </section>

          <section className="card space-y-4 p-5" aria-labelledby="sec-telebusca">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="sec-telebusca" className="font-bold text-ink">Telebusca (leva e traz)</h2>
                <p className="text-sm text-ink-muted">
                  Quando ativa, o cliente pode pedir que a equipe busque e entregue o carro no endereço cadastrado.
                </p>
              </div>
              <label className="flex flex-shrink-0 items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  role="switch"
                  checked={telebuscaEnabled}
                  onChange={(e) => setTelebuscaEnabled(e.target.checked)}
                  className="h-5 w-5 accent-amber-500"
                />
                Ativa
              </label>
            </div>
            {telebuscaEnabled && (
              <div className="w-40">
                <label htmlFor="set-fee" className="label">Taxa por veículo (R$)</label>
                <input id="set-fee" inputMode="decimal" value={telebuscaFee} onChange={(e) => setTelebuscaFee(e.target.value)} className="field" />
              </div>
            )}
          </section>

          <section className="card space-y-4 p-5" aria-labelledby="sec-cancel">
            <div>
              <h2 id="sec-cancel" className="font-bold text-ink">Cancelamento</h2>
              <p className="text-sm text-ink-muted">
                Antecedência mínima para reembolso integral nos pagamentos online. Com menos tempo, o reembolso é de 50%.
                Enquanto o pagamento for feito no local, o cliente cancela pelo app sem custo até o atendimento começar.
              </p>
            </div>
            <div className="w-40">
              <label htmlFor="set-hours" className="label">Horas de antecedência</label>
              <input
                id="set-hours"
                type="number"
                min={1}
                max={72}
                value={cancellationHours}
                onChange={(e) => setCancellationHours(e.target.value)}
                className="field"
              />
            </div>
          </section>

          <div className="flex justify-end">
            <button type="submit" disabled={save.isPending} className="btn-primary">
              <Save className="h-4 w-4" aria-hidden="true" />
              {save.isPending ? 'Salvando…' : 'Salvar configurações'}
            </button>
          </div>
        </form>
      )}

      <WhatsAppSettings />
    </div>
  );
}
