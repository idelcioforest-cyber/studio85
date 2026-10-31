import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Megaphone, Pencil, Plus, Search, Send, Trash2 } from 'lucide-react';
import { CAMPAIGN_INTERVAL_SECONDS, MAX_CAMPAIGN_BATCH, displayName } from '@autowash/shared';
import { Modal } from '../components/Modal';
import { api } from '../lib/api';
import { formatDateShort, formatPhone } from '../lib/format';
import { usePublicSettings } from '../lib/queries';

type RecipientStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELED';
type Counts = Record<RecipientStatus, number>;

interface Campaign {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  counts: Counts;
}

interface Queue {
  pending: number;
  nextAt: string | null;
}

interface Contact {
  phone: string;
  name: string;
  lastVisit: string | null;
  hasAccount: boolean;
  status: RecipientStatus | null;
  error: string | null;
}

interface WhatsAppState {
  enabled: boolean;
  configured: boolean;
  status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'UNREACHABLE';
}

// Já recebeu ou está na fila: não pode ser escolhido de novo neste aviso
const LOCKED: (RecipientStatus | null)[] = ['SENT', 'QUEUED', 'SENDING'];

const STATUS_BADGE: Record<RecipientStatus, { label: string; className: string }> = {
  SENT: { label: 'Enviado', className: 'border-success/30 bg-success/10 text-success' },
  QUEUED: { label: 'Na fila', className: 'border-info/30 bg-info/10 text-info' },
  SENDING: { label: 'Enviando', className: 'border-info/30 bg-info/10 text-info' },
  FAILED: { label: 'Não enviado', className: 'border-danger/30 bg-danger/10 text-danger' },
  CANCELED: { label: 'Parado', className: 'border-line-strong bg-subtle text-ink-muted' },
};

const timeOf = (iso: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

/** Mesma troca de variáveis do servidor, para a prévia */
function preview(body: string, name: string, company: string) {
  const first = name.split(' ')[0];
  const values: Record<string, string> = { nome: name, primeiro_nome: first, empresa: company };
  return body.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * Aviso em massa pelo WhatsApp: o dono escreve a mensagem e escolhe até 20 contatos por vez.
 * O servidor manda uma por minuto e nunca repete o mesmo aviso para o mesmo número.
 */
export default function AdminAvisosPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const whatsapp = useQuery({
    queryKey: ['admin', 'whatsapp', 'status'],
    queryFn: () => api<WhatsAppState>('/admin/whatsapp/status'),
    refetchInterval: 60_000,
  });

  return (
    <div className="animate-fadeIn mx-auto max-w-3xl space-y-5">
      {openId ? (
        <CampaignContacts id={openId} onBack={() => setOpenId(null)} whatsapp={whatsapp.data} />
      ) : (
        <CampaignList onOpen={setOpenId} whatsapp={whatsapp.data} />
      )}
    </div>
  );
}

function WhatsAppWarning({ whatsapp }: { whatsapp?: WhatsAppState }) {
  if (!whatsapp || whatsapp.status === 'CONNECTED') return null;
  return (
    <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm font-semibold text-warning" role="status">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span>
        {!whatsapp.enabled || !whatsapp.configured
          ? 'O WhatsApp está desligado no servidor. Dá para preparar os avisos, mas nada é enviado até ele ser ligado.'
          : 'O número do WhatsApp não está conectado. Dá para preparar os avisos; o envio sai quando o número for conectado em '}
        {whatsapp.enabled && whatsapp.configured && (
          <>
            <Link to="/admin/configuracoes" className="underline">Configurações</Link>.
          </>
        )}
      </span>
    </p>
  );
}

function QueueBanner({ queue, onStop, stopping }: { queue?: Queue; onStop?: () => void; stopping?: boolean }) {
  if (!queue || queue.pending === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-info/30 bg-info/10 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
      <p className="flex items-start gap-2 text-sm font-semibold text-info">
        <Send className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>
          Enviando: {queue.pending === 1 ? 'falta 1 mensagem' : `faltam ${queue.pending} mensagens`}, uma por minuto
          {queue.nextAt ? ` (próxima por volta das ${timeOf(queue.nextAt)})` : ''}. Pode fechar o app: o envio continua.
        </span>
      </p>
      {onStop && (
        <button type="button" onClick={onStop} disabled={stopping} className="btn-secondary flex-shrink-0 px-3 py-2">
          {stopping ? 'Parando…' : 'Parar envio'}
        </button>
      )}
    </div>
  );
}

function CampaignList({ onOpen, whatsapp }: { onOpen: (id: string) => void; whatsapp?: WhatsAppState }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api<{ campaigns: Campaign[]; queue: Queue }>('/admin/whatsapp/campaigns'),
    refetchInterval: (query) => (query.state.data?.queue.pending ? 10_000 : false),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/whatsapp/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
  });

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Painel</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Avisos</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Mande uma mensagem pelo WhatsApp para vários clientes: até {MAX_CAMPAIGN_BATCH} por vez, uma por minuto. Quem já recebeu um
            aviso não recebe o mesmo de novo.
          </p>
        </div>
        <button type="button" onClick={() => setEditing('new')} className="btn-primary flex-shrink-0">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo aviso
        </button>
      </header>

      <WhatsAppWarning whatsapp={whatsapp} />
      <QueueBanner queue={data?.queue} />
      {remove.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {remove.error.message}
        </p>
      )}

      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar os avisos.
        </p>
      )}
      {data && data.campaigns.length === 0 && (
        <div className="card space-y-2 p-8 text-center">
          <Megaphone className="mx-auto h-8 w-8 text-ink-muted" aria-hidden="true" />
          <p className="font-semibold text-ink">Nenhum aviso ainda</p>
          <p className="text-sm text-ink-muted">Crie um aviso, escreva a mensagem e escolha para quem mandar.</p>
        </div>
      )}

      <ul className="space-y-3">
        {data?.campaigns.map((c) => (
          <li key={c.id} className="card space-y-3 p-4 sm:p-5">
            <div>
              <h2 className="font-bold text-ink">{c.title}</h2>
              <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-ink-muted">{c.body}</p>
            </div>
            <p className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-success">{c.counts.SENT} enviado(s)</span>
              {c.counts.QUEUED + c.counts.SENDING > 0 && (
                <span className="rounded-full border border-info/30 bg-info/10 px-2.5 py-1 text-info">{c.counts.QUEUED + c.counts.SENDING} na fila</span>
              )}
              {c.counts.FAILED > 0 && (
                <span className="rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-danger">{c.counts.FAILED} não enviado(s)</span>
              )}
              <span className="px-1 py-1 font-normal text-ink-muted">Criado em {formatDateShort(c.createdAt)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onOpen(c.id)} className="btn-primary px-3 py-2">
                <Send className="h-4 w-4" aria-hidden="true" />
                Escolher contatos
              </button>
              <button type="button" onClick={() => setEditing(c)} className="btn-secondary px-3 py-2">
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Editar
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Excluir o aviso "${c.title}"? O histórico de quem recebeu também some.`)) remove.mutate(c.id);
                }}
                className="btn-secondary px-3 py-2"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>

      <CampaignModal
        campaign={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(id, isNew) => {
          setEditing(null);
          if (isNew) onOpen(id);
        }}
      />
    </>
  );
}

function CampaignModal({
  campaign,
  open,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null;
  open: boolean;
  onClose: () => void;
  onSaved: (id: string, isNew: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: settings } = usePublicSettings();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // Preenche o formulário quando abre (novo ou edição)
  useEffect(() => {
    if (!open) return;
    setTitle(campaign?.title ?? '');
    setBody(campaign?.body ?? 'Olá, {primeiro_nome}! ');
  }, [open, campaign]);

  const save = useMutation({
    mutationFn: () =>
      campaign
        ? api<Campaign>(`/admin/whatsapp/campaigns/${campaign.id}`, { method: 'PUT', body: { title, body } })
        : api<Campaign>('/admin/whatsapp/campaigns', { method: 'POST', body: { title, body } }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'campaign', saved.id] });
      onSaved(saved.id, !campaign);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={campaign ? 'Editar aviso' : 'Novo aviso'} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="campaign-title" className="label">Nome do aviso (só você vê)</label>
          <input id="campaign-title" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} className="field" placeholder="Ex.: Promoção de novembro" />
        </div>
        <div>
          <label htmlFor="campaign-body" className="label">Mensagem</label>
          <textarea
            id="campaign-body"
            required
            rows={6}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-describedby="campaign-body-hint"
            className="field"
          />
          <p id="campaign-body-hint" className="mt-1 text-xs text-ink-muted">
            {'{primeiro_nome}'} vira o primeiro nome do cliente, {'{nome}'} o nome completo e {'{empresa}'} o nome do lava-jato. {body.length}/1000
          </p>
        </div>
        {body.trim() && (
          <div>
            <p className="label">Como o cliente recebe</p>
            <p className="whitespace-pre-line rounded-xl bg-subtle p-3 text-sm text-ink">{preview(body, 'Maria da Silva', settings?.companyName || 'Studio 85')}</p>
          </div>
        )}
        {campaign && campaign.counts.SENT > 0 && (
          <p className="text-xs text-ink-muted">A mudança vale para os próximos envios; quem já recebeu não recebe de novo.</p>
        )}
        {save.error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {save.error.message}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button type="submit" disabled={save.isPending} className="btn-primary">
            {save.isPending ? 'Salvando…' : campaign ? 'Salvar' : 'Salvar e escolher contatos'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CampaignContacts({ id, onBack, whatsapp }: { id: string; onBack: () => void; whatsapp?: WhatsAppState }) {
  const queryClient = useQueryClient();
  const { data: settings } = usePublicSettings();
  const [search, setSearch] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'campaign', id],
    queryFn: () => api<{ campaign: Campaign; contacts: Contact[]; queue: Queue }>(`/admin/whatsapp/campaigns/${id}`),
    refetchInterval: (query) => (query.state.data?.queue.pending ? 10_000 : false),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'campaign', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
  };

  const send = useMutation({
    mutationFn: () =>
      api<{ queued: number; alreadySent: number; minutes: number }>(`/admin/whatsapp/campaigns/${id}/send`, {
        method: 'POST',
        body: { phones: selected },
      }),
    onSuccess: (res) => {
      setConfirming(false);
      setSelected([]);
      setResult(
        `${res.queued} mensagem(ns) na fila, uma por minuto (cerca de ${res.minutes} min).` +
          (res.alreadySent > 0 ? ` ${res.alreadySent} contato(s) já tinham recebido e ficaram de fora.` : ''),
      );
      refresh();
    },
  });
  const stop = useMutation({
    mutationFn: () => api<{ canceled: number }>(`/admin/whatsapp/campaigns/${id}/cancel`, { method: 'POST' }),
    onSuccess: (res) => {
      setResult(`Envio parado. ${res.canceled} contato(s) que estavam na fila podem ser escolhidos de novo.`);
      refresh();
    },
  });

  const contacts = data?.contacts ?? [];
  const term = search.trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  const visible = useMemo(
    () =>
      contacts.filter(
        (c) =>
          (!onlyNew || !LOCKED.includes(c.status)) &&
          (!term || c.name.toLowerCase().includes(term) || (digits.length >= 3 && c.phone.includes(digits))),
      ),
    [contacts, onlyNew, term, digits],
  );
  const full = selected.length >= MAX_CAMPAIGN_BATCH;
  const busy = (data?.queue.pending ?? 0) > 0;
  const toggle = (phone: string) =>
    setSelected((s) => (s.includes(phone) ? s.filter((p) => p !== phone) : s.length < MAX_CAMPAIGN_BATCH ? [...s, phone] : s));
  const selectNext = () => {
    const free = visible.filter((c) => !LOCKED.includes(c.status) && !selected.includes(c.phone)).map((c) => c.phone);
    setSelected((s) => [...s, ...free].slice(0, MAX_CAMPAIGN_BATCH));
  };
  const campaign = data?.campaign;
  const firstSelected = contacts.find((c) => c.phone === selected[0]);

  return (
    <>
      <div>
        <button type="button" onClick={onBack} className="btn-secondary px-3 py-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Avisos
        </button>
      </div>
      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando contatos…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar o aviso.
        </p>
      )}

      {campaign && (
        <>
          <header>
            <p className="eyebrow">Aviso</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">{campaign.title}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {campaign.counts.SENT} enviado(s)
              {campaign.counts.FAILED > 0 ? ` · ${campaign.counts.FAILED} não enviado(s)` : ''} · {contacts.length} contato(s) com celular
            </p>
          </header>

          <section className="card space-y-2 p-4" aria-label="Mensagem">
            <p className="label">Mensagem{firstSelected ? ` para ${firstSelected.name.split(' ')[0]}` : ''}</p>
            <p className="whitespace-pre-line rounded-xl bg-subtle p-3 text-sm text-ink">
              {preview(campaign.body, firstSelected ? displayName(firstSelected.name) : 'Maria da Silva', settings?.companyName || 'Studio 85')}
            </p>
          </section>

          <WhatsAppWarning whatsapp={whatsapp} />
          <QueueBanner queue={data?.queue} onStop={campaign.counts.QUEUED > 0 ? () => stop.mutate() : undefined} stopping={stop.isPending} />
          {result && (
            <p className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-semibold text-success" role="status">
              {result}
            </p>
          )}

          <section className="space-y-3" aria-labelledby="contacts-title">
            <h2 id="contacts-title" className="font-bold text-ink">Para quem mandar</h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="contact-search" className="label">Buscar por nome ou celular</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <input id="contact-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="field pl-9" />
                </div>
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm font-semibold text-ink">
                <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                Só quem ainda não recebeu
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={selectNext} disabled={full} className="btn-secondary px-3 py-2">
                Marcar os próximos {MAX_CAMPAIGN_BATCH - selected.length > 0 ? MAX_CAMPAIGN_BATCH - selected.length : ''}
              </button>
              {selected.length > 0 && (
                <button type="button" onClick={() => setSelected([])} className="btn-secondary px-3 py-2">
                  Limpar
                </button>
              )}
            </div>

            {visible.length === 0 && !isLoading && (
              <p className="card p-6 text-center text-sm text-ink-muted">
                {contacts.length === 0 ? 'Nenhum cliente com celular cadastrado.' : 'Ninguém encontrado com esse filtro.'}
              </p>
            )}
            <ul className="space-y-2">
              {visible.map((c) => {
                const locked = LOCKED.includes(c.status);
                const checked = selected.includes(c.phone);
                const badge = c.status ? STATUS_BADGE[c.status] : null;
                return (
                  <li key={c.phone}>
                    <label
                      className={`card flex items-start gap-3 p-3 ${locked ? 'opacity-70' : 'cursor-pointer'} ${checked ? 'border-accent ring-1 ring-accent' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked || (!checked && full)}
                        onChange={() => toggle(c.phone)}
                        className="mt-1 h-4 w-4 flex-shrink-0 accent-amber-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{c.name}</span>
                          {badge && <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${badge.className}`}>{badge.label}</span>}
                        </span>
                        <span className="block text-sm text-ink-muted">
                          {formatPhone(c.phone)}
                          {c.lastVisit ? ` · Último agendamento ${formatDateShort(c.lastVisit)}` : ''}
                          {c.hasAccount ? '' : ' · Balcão'}
                        </span>
                        {c.status === 'FAILED' && c.error && <span className="block text-xs text-danger">{c.error}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="card sticky bottom-20 z-30 flex flex-col gap-2 p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between xl:bottom-4">
            <p className="text-sm font-semibold text-ink" aria-live="polite">
              {selected.length} de {MAX_CAMPAIGN_BATCH} escolhidos
              {busy && <span className="block text-xs font-normal text-ink-muted">Espere a fila atual terminar para mandar mais.</span>}
            </p>
            <button type="button" disabled={selected.length === 0 || busy} onClick={() => setConfirming(true)} className="btn-primary">
              <Send className="h-4 w-4" aria-hidden="true" />
              Enviar para {selected.length || ''} contato{selected.length === 1 ? '' : 's'}
            </button>
          </div>

          <Modal open={confirming} onClose={() => setConfirming(false)} title="Enviar aviso">
            <div className="space-y-4">
              <p className="text-sm text-ink">
                Vão sair {selected.length} mensagem(ns) pelo WhatsApp, uma por minuto (cerca de{' '}
                {Math.ceil((selected.length * CAMPAIGN_INTERVAL_SECONDS) / 60)} min). Pode fechar o app: o envio continua.
              </p>
              {send.error && (
                <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
                  {send.error.message}
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setConfirming(false)} className="btn-secondary">
                  Voltar
                </button>
                <button type="button" disabled={send.isPending} onClick={() => send.mutate()} className="btn-primary">
                  {send.isPending ? 'Enviando…' : 'Confirmar envio'}
                </button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </>
  );
}
