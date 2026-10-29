import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Smartphone, Unplug, Send, Check } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, formatPhone } from '../lib/format';

interface Status {
  enabled: boolean;
  configured: boolean;
  status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'UNREACHABLE';
  phone: string | null;
}

interface Template {
  key: 'APPOINTMENT_CONFIRMED' | 'CAR_READY';
  title: string;
  body: string;
  isActive: boolean;
  attachPhotos: boolean;
}

interface SentMessage {
  id: string;
  templateKey: string | null;
  phone: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  error: string | null;
  mediaCount: number;
  createdAt: string;
  appointment: { readableCode: string; customerName: string } | null;
}

const statusText: Record<Status['status'], { label: string; tone: string }> = {
  CONNECTED: { label: 'Conectado', tone: 'border-success/30 bg-success/10 text-success' },
  CONNECTING: { label: 'Aguardando leitura do QR code', tone: 'border-warning/30 bg-warning/10 text-warning' },
  DISCONNECTED: { label: 'Desconectado', tone: 'border-line bg-subtle text-ink-muted' },
  UNREACHABLE: { label: 'Serviço de WhatsApp fora do ar', tone: 'border-danger/30 bg-danger/10 text-danger' },
};

const sentLabels: Record<SentMessage['status'], { label: string; tone: string }> = {
  SENT: { label: 'Enviada', tone: 'text-success' },
  FAILED: { label: 'Falhou', tone: 'text-danger' },
  SKIPPED: { label: 'Não enviada', tone: 'text-warning' },
};

export function WhatsAppSettings() {
  const queryClient = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');

  const status = useQuery({
    queryKey: ['admin', 'whatsapp', 'status'],
    queryFn: () => api<Status>('/admin/whatsapp/status'),
    refetchInterval: qr ? false : 30_000,
  });

  // Enquanto o QR está na tela, consulta a cada 3 s até o número conectar
  const qrPoll = useQuery({
    queryKey: ['admin', 'whatsapp', 'qr'],
    queryFn: () => api<{ qr: string | null; status: string }>('/admin/whatsapp/qr'),
    enabled: Boolean(qr),
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!qrPoll.data) return;
    if (qrPoll.data.status === 'CONNECTED') {
      setQr(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp'] });
    } else if (qrPoll.data.qr) {
      setQr(qrPoll.data.qr);
    }
  }, [qrPoll.data, queryClient]);

  const connect = useMutation({
    mutationFn: () => api<{ qr: string | null; status: string }>('/admin/whatsapp/connect', { method: 'POST' }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'status'] });
      if (res.status !== 'CONNECTED') setQr(res.qr);
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api('/admin/whatsapp/connection', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp'] }),
  });

  const test = useMutation({
    mutationFn: () => api<{ status: SentMessage['status']; error: string | null }>('/admin/whatsapp/test', { method: 'POST', body: { phone: testPhone } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'messages'] }),
  });

  const templates = useQuery({
    queryKey: ['admin', 'whatsapp', 'templates'],
    queryFn: () => api<{ variables: string[]; templates: Template[] }>('/admin/whatsapp/templates'),
  });

  const messages = useQuery({
    queryKey: ['admin', 'whatsapp', 'messages'],
    queryFn: () => api<SentMessage[]>('/admin/whatsapp/messages?limit=10'),
  });

  const current = status.data;

  return (
    <section className="card space-y-5 p-5" aria-labelledby="sec-whatsapp">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sec-whatsapp" className="flex items-center gap-2 font-bold text-ink">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            WhatsApp
          </h2>
          <p className="text-sm text-ink-muted">
            Conecte o número do Studio 85 para enviar a confirmação do agendamento e o aviso de carro pronto, com as fotos.
          </p>
        </div>
        {current && (
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusText[current.status].tone}`}>
            {statusText[current.status].label}
            {current.status === 'CONNECTED' && current.phone ? ` · ${formatPhone(current.phone)}` : ''}
          </span>
        )}
      </div>

      {current && !current.configured && (
        <p className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm text-info">
          O serviço de WhatsApp ainda não foi instalado no servidor. Depois de instalado, o número é conectado aqui pelo QR code.
        </p>
      )}
      {current?.configured && !current.enabled && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          Os envios automáticos estão desligados no servidor (WHATSAPP_ENABLED). A mensagem de teste funciona normalmente.
        </p>
      )}

      {current?.configured && (
        <div className="flex flex-wrap gap-2">
          {current.status !== 'CONNECTED' ? (
            <button type="button" onClick={() => connect.mutate()} disabled={connect.isPending || Boolean(qr)} className="btn-primary">
              <Smartphone className="h-4 w-4" aria-hidden="true" />
              {connect.isPending ? 'Gerando QR code…' : 'Conectar número'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Desconectar o WhatsApp? As mensagens automáticas param até conectar de novo.')) disconnect.mutate();
              }}
              disabled={disconnect.isPending}
              className="btn-secondary"
            >
              <Unplug className="h-4 w-4" aria-hidden="true" />
              Desconectar
            </button>
          )}
        </div>
      )}
      {(connect.error || disconnect.error) && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {(connect.error ?? disconnect.error)?.message}
        </p>
      )}

      {qr && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line p-4 text-center sm:flex-row sm:text-left">
          <img src={qr} alt="QR code para conectar o WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
          <div className="space-y-2 text-sm text-ink">
            <p className="font-semibold">Para conectar:</p>
            <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
              <li>Abra o WhatsApp no celular do Studio 85.</li>
              <li>Toque em Configurações → Aparelhos conectados → Conectar um aparelho.</li>
              <li>Aponte a câmera para este QR code.</li>
            </ol>
            <p className="text-xs text-ink-muted">O código se renova sozinho. Esta tela atualiza quando conectar.</p>
            <button type="button" onClick={() => setQr(null)} className="btn-secondary px-3 py-1.5">Cancelar</button>
          </div>
        </div>
      )}

      {current?.configured && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            test.mutate();
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <div>
            <label htmlFor="wa-test" className="label">Enviar mensagem de teste para</label>
            <input id="wa-test" type="tel" required value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="(51) 99999-9999" className="field w-52" />
          </div>
          <button type="submit" disabled={test.isPending} className="btn-secondary">
            <Send className="h-4 w-4" aria-hidden="true" />
            {test.isPending ? 'Enviando…' : 'Enviar teste'}
          </button>
          {test.data && (
            <p className={`w-full text-sm font-semibold ${sentLabels[test.data.status].tone}`} role="status">
              {test.data.status === 'SENT' ? 'Mensagem de teste enviada.' : `Não enviada: ${test.data.error}`}
            </p>
          )}
        </form>
      )}

      <div className="space-y-3 border-t border-line pt-4">
        <h3 className="font-bold text-ink">Mensagens automáticas</h3>
        {templates.data && (
          <p className="text-xs text-ink-muted">
            Variáveis que você pode usar: {templates.data.variables.map((v) => `{${v}}`).join(' ')}
          </p>
        )}
        {templates.data?.templates.map((t) => <TemplateEditor key={t.key} template={t} />)}
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="font-bold text-ink">Últimos envios</h3>
        {messages.data?.length === 0 && <p className="text-sm text-ink-muted">Nenhuma mensagem ainda.</p>}
        <ul className="divide-y divide-line text-sm">
          {messages.data?.map((m) => {
            const when = formatDateTime(m.createdAt);
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-ink">
                  {m.appointment ? `${m.appointment.customerName} · ${m.appointment.readableCode}` : `Teste · ${formatPhone(m.phone)}`}
                  {m.mediaCount > 0 && <span className="text-ink-muted"> · {m.mediaCount} foto(s)</span>}
                </span>
                <span className="text-xs text-ink-muted">
                  {when.date} {when.time} ·{' '}
                  <span className={`font-semibold ${sentLabels[m.status].tone}`}>{sentLabels[m.status].label}</span>
                  {m.error && ` · ${m.error}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function TemplateEditor({ template }: { template: Template }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState(template.body);
  const [isActive, setIsActive] = useState(template.isActive);
  const [attachPhotos, setAttachPhotos] = useState(template.attachPhotos);
  const [saved, setSaved] = useState(false);
  const id = `tpl-${template.key}`;

  const save = useMutation({
    mutationFn: () => api(`/admin/whatsapp/templates/${template.key}`, { method: 'PUT', body: { body, isActive, attachPhotos } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'templates'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-2 rounded-xl border border-line p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="font-semibold text-ink">{template.title}</label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" role="switch" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          Enviar automaticamente
        </label>
      </div>
      <textarea id={id} rows={6} value={body} onChange={(e) => setBody(e.target.value)} className="field font-mono text-xs" />
      {template.key === 'CAR_READY' && (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={attachPhotos} onChange={(e) => setAttachPhotos(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          Enviar junto as fotos de depois (até 6)
        </label>
      )}
      {save.error && <p className="text-sm text-danger" role="alert">{save.error.message}</p>}
      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="flex items-center gap-1 text-sm font-semibold text-success" role="status">
            <Check className="h-4 w-4" aria-hidden="true" /> Salvo
          </span>
        )}
        <button type="submit" disabled={save.isPending} className="btn-secondary px-3 py-1.5">Salvar mensagem</button>
      </div>
    </form>
  );
}
