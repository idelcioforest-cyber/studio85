import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateShort, formatPlate, formatPrice } from '../lib/format';
import { CardFields, CardInput, FeeBreakdown, emptyCard, tokenizeCard } from '../components/PayOnlineModal';

interface SetupView {
  status: 'PENDING_CARD' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  processing: boolean;
  lastError: string | null;
  firstName: string;
  planName: string;
  washesPerMonth: number;
  services: string[];
  vehicle: { label: string; plate: string | null };
  priceCents: number;
  customerFeeCents: number;
  chargedCents: number;
  card: { brand: string | null; last4: string } | null;
  periodEnd: string | null;
  needs: { email: boolean; cpf: boolean; phone: boolean };
  publicKey: string | null;
}

/**
 * Link privado que o dono manda ao cliente para cadastrar o cartão da assinatura.
 * Não aparece em menu nenhum e não é indexado.
 */
export default function SubscriptionSetupPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const [card, setCard] = useState<CardInput>(emptyCard);
  const [extra, setExtra] = useState({ email: '', cpf: '', phone: '' });
  const [agreed, setAgreed] = useState(false);

  const view = useQuery({
    queryKey: ['subscription-setup', token],
    queryFn: () => api<SetupView>(`/subscriptions/setup/${encodeURIComponent(token)}`),
    retry: false,
    // Enquanto o Pagar.me confirma a 1ª mensalidade, consulta a cada 5 s
    refetchInterval: (query) => (query.state.data?.processing ? 5000 : false),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const cardToken = await tokenizeCard(view.data!.publicKey!, card);
      return api<SetupView>(`/subscriptions/setup/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: {
          cardToken,
          email: view.data!.needs.email ? extra.email : null,
          cpf: view.data!.needs.cpf ? extra.cpf : null,
          phone: view.data!.needs.phone ? extra.phone : null,
        },
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['subscription-setup', token], data);
      setCard(emptyCard);
    },
  });

  useEffect(() => {
    if (view.data?.lastError) setAgreed(false);
  }, [view.data?.lastError]);

  const data = view.data;
  return (
    <div className="animate-fadeIn mx-auto max-w-lg space-y-5">
      {view.isLoading && <p className="py-16 text-center text-sm text-ink-muted">Carregando…</p>}
      {view.isError && (
        <div className="card p-6 text-center" role="alert">
          <p className="font-semibold text-ink">{view.error.message}</p>
        </div>
      )}

      {data && (
        <>
          <header>
            <p className="eyebrow">Assinatura</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">
              {data.status === 'ACTIVE' ? `Tudo certo, ${data.firstName}!` : `Olá, ${data.firstName}`}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Plano <strong className="text-ink">{data.planName}</strong> para o {data.vehicle.label} ({formatPlate(data.vehicle.plate)}).
            </p>
          </header>

          <section className="card space-y-3 p-5" aria-label="O que está incluído">
            <p className="text-sm text-ink">
              <strong>{data.washesPerMonth}</strong> lavagem(ns) por mês com: {data.services.join(', ')}.
            </p>
            {data.customerFeeCents > 0 ? (
              <FeeBreakdown
                label="Mensalidade do plano"
                charge={{ baseCents: data.priceCents, feeCents: data.customerFeeCents, totalCents: data.chargedCents }}
              />
            ) : (
              <p className="text-sm text-ink">
                Mensalidade: <strong>{formatPrice(data.chargedCents)}</strong>
              </p>
            )}
            <p className="text-xs text-ink-muted">Ao agendar, os serviços do plano aparecem sem custo até acabar a quantidade do mês.</p>
          </section>

          {data.status === 'ACTIVE' && (
            <section className="card space-y-2 p-5 text-center" role="status">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden="true" />
              <p className="font-semibold text-ink">Assinatura ativa</p>
              <p className="text-sm text-ink-muted">
                {data.periodEnd ? `Pago até ${formatDateShort(data.periodEnd)}. ` : ''}A mensalidade é cobrada todo mês
                {data.card ? ` no cartão final ${data.card.last4}` : ''}. Para cancelar, fale com o lava-jato.
              </p>
            </section>
          )}

          {data.status === 'PAST_DUE' && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning" role="status">
              A última mensalidade não passou no cartão. O Pagar.me tenta de novo nos próximos dias; se preferir, fale com o lava-jato.
            </p>
          )}

          {data.status === 'PENDING_CARD' && data.processing && (
            <p className="flex items-center gap-2 rounded-xl border border-line bg-subtle p-3 text-sm text-ink" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Confirmando o pagamento com o cartão… esta tela atualiza sozinha.
            </p>
          )}

          {data.status === 'PENDING_CARD' && !data.processing && (
            <section className="card space-y-4 p-5" aria-labelledby="setup-card">
              <h2 id="setup-card" className="flex items-center gap-2 font-bold text-ink">
                <CreditCard className="h-5 w-5" aria-hidden="true" />
                Cartão para a mensalidade
              </h2>
              {!data.publicKey ? (
                <p className="text-sm text-ink-muted">O pagamento online está indisponível no momento. Tente mais tarde ou fale com o lava-jato.</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit.mutate();
                  }}
                  className="space-y-3"
                >
                  {data.lastError && (
                    <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning" role="alert">
                      {data.lastError}
                    </p>
                  )}
                  {data.needs.email && (
                    <div>
                      <label htmlFor="setup-email" className="label">Seu e-mail</label>
                      <input id="setup-email" type="email" autoComplete="email" required value={extra.email} onChange={(e) => setExtra({ ...extra, email: e.target.value })} className="field" />
                    </div>
                  )}
                  {data.needs.cpf && (
                    <div>
                      <label htmlFor="setup-cpf" className="label">Seu CPF</label>
                      <input id="setup-cpf" inputMode="numeric" required value={extra.cpf} onChange={(e) => setExtra({ ...extra, cpf: e.target.value })} className="field" />
                    </div>
                  )}
                  {data.needs.phone && (
                    <div>
                      <label htmlFor="setup-phone" className="label">Celular com DDD</label>
                      <input id="setup-phone" type="tel" autoComplete="tel" required value={extra.phone} onChange={(e) => setExtra({ ...extra, phone: e.target.value })} className="field" />
                    </div>
                  )}
                  <CardFields card={card} onChange={setCard} />
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
                    Autorizo a cobrança de {formatPrice(data.chargedCents)} por mês neste cartão até eu pedir o cancelamento.
                  </label>
                  {submit.error && (
                    <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
                      {submit.error.message}
                    </p>
                  )}
                  <button type="submit" disabled={submit.isPending || !agreed} className="btn-primary w-full">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    {submit.isPending ? 'Processando…' : `Ativar assinatura (${formatPrice(data.chargedCents)}/mês)`}
                  </button>
                  <p className="text-xs text-ink-muted">Os dados do cartão vão direto para o Pagar.me, com segurança. O Studio 85 não guarda o número.</p>
                </form>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
