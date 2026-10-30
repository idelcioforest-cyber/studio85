import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Save } from 'lucide-react';
import { OnlineFeeRates, cardCharge, pixCharge } from '@autowash/shared';
import { api } from '../lib/api';
import { centsToInput, formatPrice, parsePriceInput } from '../lib/format';
import { WhatsAppSettings } from '../components/WhatsAppSettings';

interface AdminSettings {
  companyName: string;
  phone: string | null;
  telebuscaEnabled: boolean;
  telebuscaFeeCents: number;
  cancellationLimitHours: number;
  onlinePaymentsEnabled: boolean;
  subscriptionsEnabled: boolean;
  onlineFees: OnlineFeeRates;
}

// Percentual e valor fixo digitados como "4,99": 4,99% = 499 centésimos; R$ 0,50 = 50 centavos
const toInput = (value: number) => centsToInput(value);
const fromInput = (value: string) => parsePriceInput(value) ?? 0;
const EXAMPLE_CENTS = 6000;

interface FeeForm {
  pixPercent: string;
  pixFixed: string;
  cardFixed: string;
  cardPercents: string[];
  maxInstallments: number;
}

function feeFormOf(rates: OnlineFeeRates): FeeForm {
  return {
    pixPercent: toInput(rates.pixPercentBp),
    pixFixed: toInput(rates.pixFixedCents),
    cardFixed: toInput(rates.cardFixedCents),
    cardPercents: rates.cardPercentBp.map(toInput),
    maxInstallments: rates.maxInstallments,
  };
}

function ratesOfForm(form: FeeForm): OnlineFeeRates {
  return {
    pixPercentBp: fromInput(form.pixPercent),
    pixFixedCents: fromInput(form.pixFixed),
    cardFixedCents: fromInput(form.cardFixed),
    cardPercentBp: form.cardPercents.map(fromInput),
    maxInstallments: form.maxInstallments,
  };
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
  const [onlinePaymentsEnabled, setOnlinePaymentsEnabled] = useState(true);
  const [subscriptionsEnabled, setSubscriptionsEnabled] = useState(false);
  const [fees, setFees] = useState<FeeForm | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setCompanyName(data.companyName);
    setPhone(data.phone ?? '');
    setTelebuscaEnabled(data.telebuscaEnabled);
    setTelebuscaFee((data.telebuscaFeeCents / 100).toFixed(2).replace('.', ','));
    setCancellationHours(String(data.cancellationLimitHours));
    setOnlinePaymentsEnabled(data.onlinePaymentsEnabled);
    setSubscriptionsEnabled(data.subscriptionsEnabled);
    setFees(feeFormOf(data.onlineFees));
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
          onlinePaymentsEnabled,
          subscriptionsEnabled,
          ...(fees ? { onlineFees: ratesOfForm(fees) } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'public'] });
      queryClient.invalidateQueries({ queryKey: ['payments-online-config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="animate-fadeIn mx-auto max-w-3xl space-y-6">
      <header>
        <p className="eyebrow">Configuração</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Configurações</h1>
        <p className="mt-1 text-sm text-ink-muted">Dados do estabelecimento, Telebusca, pagamento online, assinaturas e regra de cancelamento.</p>
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

          <section className="card space-y-4 p-5" aria-labelledby="sec-online">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="sec-online" className="font-bold text-ink">Pagamento no app</h2>
                <p className="text-sm text-ink-muted">
                  Ligado, o cliente pode pagar o agendamento pelo app com Pix ou cartão. Desligado, o app não oferece pagamento
                  online e tudo é pago no local, na retirada. Pagamentos já feitos e reembolsos continuam funcionando.
                </p>
              </div>
              <label className="flex flex-shrink-0 items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  role="switch"
                  checked={onlinePaymentsEnabled}
                  onChange={(e) => setOnlinePaymentsEnabled(e.target.checked)}
                  className="h-5 w-5 accent-amber-500"
                />
                Ligado
              </label>
            </div>
          </section>

          {fees && onlinePaymentsEnabled && <OnlineFeesSection fees={fees} onChange={setFees} />}

          <section className="card space-y-4 p-5" aria-labelledby="sec-subs">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="sec-subs" className="font-bold text-ink">Assinaturas</h2>
                <p className="text-sm text-ink-muted">
                  Liberadas, aparece o menu Assinaturas no painel para você montar os planos e ativar para os clientes. O site não
                  divulga nada: só quem recebe o seu link fica sabendo. Desligar não cancela quem já assina.
                </p>
                {subscriptionsEnabled && !onlinePaymentsEnabled && (
                  <p className="mt-2 text-sm font-semibold text-warning">
                    Com o pagamento no app desligado, não dá para ativar novas assinaturas nem cadastrar cartões. Quem já assina
                    continua sendo cobrado.
                  </p>
                )}
              </div>
              <label className="flex flex-shrink-0 items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  role="switch"
                  checked={subscriptionsEnabled}
                  onChange={(e) => setSubscriptionsEnabled(e.target.checked)}
                  className="h-5 w-5 accent-amber-500"
                />
                Liberadas
              </label>
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

/** Taxas do contrato com o Pagar.me: o cliente paga a taxa e o valor do serviço chega inteiro */
function OnlineFeesSection({ fees, onChange }: { fees: FeeForm; onChange: (fees: FeeForm) => void }) {
  const rates = ratesOfForm(fees);
  const pix = pixCharge(EXAMPLE_CENTS, rates);
  const card1 = cardCharge(EXAMPLE_CENTS, 1, rates);
  const cardMax = cardCharge(EXAMPLE_CENTS, fees.maxInstallments, rates);
  const setPercent = (index: number, value: string) => onChange({ ...fees, cardPercents: fees.cardPercents.map((p, i) => (i === index ? value : p)) });

  return (
    <section className="card space-y-4 p-5" aria-labelledby="sec-fees">
      <div>
        <h2 id="sec-fees" className="font-bold text-ink">Pagamento online: taxas e parcelas</h2>
        <p className="text-sm text-ink-muted">
          Informe as taxas do seu contrato com o Pagar.me (no painel deles, em Taxas). O cliente paga a taxa no pagamento online,
          inclusive no cartão em 1x; quem paga na loja não paga taxa.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">Pix</legend>
        <div className="grid grid-cols-2 gap-3 sm:w-80">
          <div>
            <label htmlFor="fee-pix-pct" className="label">Taxa (%)</label>
            <input id="fee-pix-pct" inputMode="decimal" value={fees.pixPercent} onChange={(e) => onChange({ ...fees, pixPercent: e.target.value })} className="field" />
          </div>
          <div>
            <label htmlFor="fee-pix-fixed" className="label">Fixo por Pix (R$)</label>
            <input id="fee-pix-fixed" inputMode="decimal" value={fees.pixFixed} onChange={(e) => onChange({ ...fees, pixFixed: e.target.value })} className="field" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">Cartão de crédito</legend>
        <div className="grid grid-cols-2 gap-3 sm:w-80">
          <div>
            <label htmlFor="fee-card-max" className="label">Parcelar em até</label>
            <select
              id="fee-card-max"
              value={fees.maxInstallments}
              onChange={(e) => onChange({ ...fees, maxInstallments: Number(e.target.value) })}
              className="field"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'Só à vista (1x)' : `${n}x`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fee-card-fixed" className="label">Fixo por cartão (R$)</label>
            <input id="fee-card-fixed" inputMode="decimal" value={fees.cardFixed} onChange={(e) => onChange({ ...fees, cardFixed: e.target.value })} className="field" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {Array.from({ length: fees.maxInstallments }, (_, i) => (
            <div key={i}>
              <label htmlFor={`fee-card-${i + 1}`} className="label">
                {i + 1}x (%)
              </label>
              <input id={`fee-card-${i + 1}`} inputMode="decimal" value={fees.cardPercents[i]} onChange={(e) => setPercent(i, e.target.value)} className="field" />
            </div>
          ))}
        </div>
      </fieldset>

      <p className="rounded-xl bg-subtle p-3 text-sm text-ink-muted">
        Exemplo, serviço de {formatPrice(EXAMPLE_CENTS)}: no Pix o cliente paga <strong className="text-ink">{formatPrice(pix.totalCents)}</strong>, no
        cartão em 1x <strong className="text-ink">{formatPrice(card1.totalCents)}</strong>
        {fees.maxInstallments > 1 && (
          <>
            {' '}
            e em {fees.maxInstallments}x <strong className="text-ink">{formatPrice(cardMax.totalCents)}</strong>
          </>
        )}
        . Descontada a taxa, chegam os {formatPrice(EXAMPLE_CENTS)}.
      </p>
    </section>
  );
}
