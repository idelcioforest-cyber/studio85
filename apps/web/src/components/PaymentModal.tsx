import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QrCode, CreditCard, Banknote, Paperclip, type LucideIcon } from 'lucide-react';
import { Modal } from './Modal';
import { api, uploadFile, MAX_RECEIPT_MB, RECEIPT_ACCEPT } from '../lib/api';
import { formatDateTime, formatPlate, formatPrice } from '../lib/format';
import { Appointment, PaymentMethod, paymentMethodLabels } from '../lib/types';

const methodIcons: Record<PaymentMethod, LucideIcon> = {
  PIX: QrCode,
  CREDIT_CARD: CreditCard,
  DEBIT_CARD: CreditCard,
  CASH: Banknote,
};

export function validateReceipt(file: File | null): string | null {
  if (!file) return null;
  if (!RECEIPT_ACCEPT.split(',').includes(file.type)) return 'Envie uma foto (JPG, PNG ou WEBP) ou um PDF.';
  if (file.size > MAX_RECEIPT_MB * 1024 * 1024) return `Arquivo muito grande. Envie até ${MAX_RECEIPT_MB} MB.`;
  return null;
}

/**
 * Recebimento na retirada: o carro já vem do agendamento, só falta escolher a forma de pagamento.
 * Para Pix e cartão pagos fora do sistema, dá para anexar o comprovante (opcional).
 */
export function PaymentModal({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState<string | null>(null);

  useEffect(() => {
    setMethod(null);
    setReceipt(null);
    setReceiptError(null);
    setUploadFailed(null);
  }, [appointment?.id]);

  const pay = useMutation({
    mutationFn: async () => {
      await api(`/admin/appointments/${appointment!.id}/pay`, { method: 'POST', body: { method } });
      if (receipt && method !== 'CASH') {
        try {
          await uploadFile(`/admin/appointments/${appointment!.id}/receipt`, receipt);
        } catch (err) {
          return { uploadError: err instanceof Error ? err.message : 'Falha ao enviar o comprovante.' };
        }
      }
      return { uploadError: null };
    },
    onSuccess: ({ uploadError }) => {
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      if (uploadError) setUploadFailed(uploadError);
      else onClose();
    },
  });

  if (!appointment) return null;
  const when = formatDateTime(appointment.startsAt);

  if (uploadFailed) {
    return (
      <Modal open onClose={onClose} title="Pagamento registrado">
        <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning" role="alert">
          O pagamento foi registrado, mas o comprovante não foi enviado: {uploadFailed} Você pode anexar depois pelo Caixa,
          na aba Recebidos.
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-primary">Fechar</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Receber pagamento" description="Escolha a forma de pagamento e confirme.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          pay.mutate();
        }}
        className="space-y-4"
      >
        <dl className="space-y-1.5 rounded-xl bg-subtle p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Veículo</dt>
            <dd className="text-right font-semibold text-ink">
              {appointment.vehicleLabel} · <span className="font-mono">{formatPlate(appointment.vehiclePlate)}</span>
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Cliente</dt>
            <dd className="text-right font-semibold text-ink">{appointment.customerName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Serviços</dt>
            <dd className="text-right font-semibold text-ink">
              {appointment.services.map((s) => s.name).join(', ')} · {when.time}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
            <dt className="font-semibold text-ink">Total</dt>
            <dd className="text-2xl font-extrabold text-ink">{formatPrice(appointment.totalPriceCents)}</dd>
          </div>
        </dl>

        <fieldset>
          <legend className="label">Forma de pagamento</legend>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(paymentMethodLabels) as PaymentMethod[]).map((key) => {
              const Icon = methodIcons[key];
              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-accent ${
                    method === key ? 'border-accent bg-accent/10 text-ink' : 'border-line-strong text-ink hover:border-accent'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment-method"
                    checked={method === key}
                    onChange={() => setMethod(key)}
                    className="sr-only"
                  />
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {paymentMethodLabels[key]}
                </label>
              );
            })}
          </div>
        </fieldset>

        {method && method !== 'CASH' && (
          <div>
            <label htmlFor="receipt-file" className="label">
              Comprovante <span className="font-normal text-ink-muted">(opcional)</span>
            </label>
            <input
              id="receipt-file"
              type="file"
              accept={RECEIPT_ACCEPT}
              aria-describedby="receipt-help"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                const error = validateReceipt(file);
                setReceiptError(error);
                setReceipt(error ? null : file);
              }}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-subtle"
            />
            <p id="receipt-help" className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              Foto ou PDF do Pix ou da maquininha, até {MAX_RECEIPT_MB} MB.
            </p>
            {receiptError && <p className="mt-1 text-xs font-medium text-danger">{receiptError}</p>}
          </div>
        )}

        {pay.error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {pay.error.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button type="submit" disabled={!method || pay.isPending} className="btn-primary">
            {pay.isPending ? 'Registrando…' : `Confirmar ${formatPrice(appointment.totalPriceCents)}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
