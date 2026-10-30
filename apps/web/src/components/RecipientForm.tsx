import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { centsToInput, parsePriceInput } from '../lib/format';

export interface RecipientView {
  type: 'individual' | 'corporation';
  name: string;
  tradingName: string | null;
  email: string;
  documentMasked: string;
  phone: string;
  birthOrFoundingDate: string;
  incomeCents: number;
  professionalOccupation: string | null;
  street: string;
  streetNumber: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  partner: { name: string; email: string; cpfMasked: string; birthdate: string; incomeCents: number; occupation: string } | null;
  bankHolderName: string;
  bankCode: string;
  branchNumber: string;
  branchCheckDigit: string | null;
  accountMasked: string;
  accountCheckDigit: string;
  accountType: 'checking' | 'savings';
  feePercent: number | null;
  pagarmeRecipientId: string | null;
}

const blank = {
  type: 'individual' as 'individual' | 'corporation',
  name: '',
  tradingName: '',
  email: '',
  document: '',
  phone: '',
  birthOrFoundingDate: '',
  income: '',
  professionalOccupation: '',
  zipCode: '',
  street: '',
  streetNumber: '',
  complement: '',
  neighborhood: '',
  city: 'Porto Alegre',
  state: 'RS',
  partnerName: '',
  partnerEmail: '',
  partnerCpf: '',
  partnerBirthdate: '',
  partnerIncome: '',
  partnerOccupation: '',
  bankHolderName: '',
  bankCode: '',
  branchNumber: '',
  branchCheckDigit: '',
  accountNumber: '',
  accountCheckDigit: '',
  accountType: 'checking' as 'checking' | 'savings',
  feePercent: '',
};

function fromView(r: RecipientView | null): typeof blank {
  if (!r) return blank;
  return {
    ...blank,
    type: r.type,
    name: r.name,
    tradingName: r.tradingName ?? '',
    email: r.email,
    phone: r.phone,
    birthOrFoundingDate: r.birthOrFoundingDate,
    income: centsToInput(r.incomeCents),
    professionalOccupation: r.professionalOccupation ?? '',
    zipCode: r.zipCode,
    street: r.street,
    streetNumber: r.streetNumber,
    complement: r.complement ?? '',
    neighborhood: r.neighborhood,
    city: r.city,
    state: r.state,
    partnerName: r.partner?.name ?? '',
    partnerEmail: r.partner?.email ?? '',
    partnerBirthdate: r.partner?.birthdate ?? '',
    partnerIncome: r.partner ? centsToInput(r.partner.incomeCents) : '',
    partnerOccupation: r.partner?.occupation ?? '',
    bankHolderName: r.bankHolderName,
    bankCode: r.bankCode,
    branchNumber: r.branchNumber,
    branchCheckDigit: r.branchCheckDigit ?? '',
    accountCheckDigit: r.accountCheckDigit,
    accountType: r.accountType,
    feePercent: r.feePercent === null ? '' : String(r.feePercent),
  };
}

/**
 * Cadastro do recebedor do lava-jato. CPF/CNPJ e número da conta nunca voltam do servidor:
 * para salvar de novo, é preciso digitá-los outra vez.
 */
export function RecipientForm({ recipient, onSaved }: { recipient: RecipientView | null; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [f, setF] = useState(() => fromView(recipient));
  const set = (patch: Partial<typeof blank>) => setF((prev) => ({ ...prev, ...patch }));
  const pj = f.type === 'corporation';
  const registered = Boolean(recipient?.pagarmeRecipientId);

  const save = useMutation({
    mutationFn: () =>
      api<{ message?: string }>('/admin/payments/recipient', {
        method: 'PUT',
        body: {
          type: f.type,
          name: f.name,
          tradingName: pj ? f.tradingName : undefined,
          email: f.email,
          document: f.document,
          phone: f.phone,
          birthOrFoundingDate: f.birthOrFoundingDate,
          incomeCents: parsePriceInput(f.income) ?? 0,
          professionalOccupation: pj ? undefined : f.professionalOccupation,
          zipCode: f.zipCode,
          street: f.street,
          streetNumber: f.streetNumber,
          complement: f.complement || undefined,
          neighborhood: f.neighborhood,
          city: f.city,
          state: f.state,
          partner: pj
            ? {
                name: f.partnerName,
                email: f.partnerEmail,
                cpf: f.partnerCpf,
                birthdate: f.partnerBirthdate,
                incomeCents: parsePriceInput(f.partnerIncome) ?? 0,
                occupation: f.partnerOccupation,
              }
            : undefined,
          bankHolderName: f.bankHolderName,
          bankCode: f.bankCode,
          branchNumber: f.branchNumber,
          branchCheckDigit: f.branchCheckDigit || undefined,
          accountNumber: f.accountNumber,
          accountCheckDigit: f.accountCheckDigit,
          accountType: f.accountType,
          feePercent: f.feePercent === '' ? null : Number(f.feePercent),
        },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] });
      queryClient.invalidateQueries({ queryKey: ['payments-online-config'] });
      set({ document: '', accountNumber: '', partnerCpf: '' });
      onSaved(res.message || 'Recebedor salvo.');
    },
  });

  const err = (field: string) => (save.error instanceof ApiError ? save.error.fieldError(field) : undefined);
  const input = (id: string, label: string, key: keyof typeof blank, props: React.InputHTMLAttributes<HTMLInputElement> = {}, errorField = key as string) => (
    <Field id={id} label={label} error={err(errorField)}>
      <input id={id} value={f[key] as string} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof blank>)} className="field" {...props} />
    </Field>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-6"
      noValidate
    >
      {registered && (
        <p className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm text-info">
          O recebedor já está no Pagar.me: daqui só mudam a conta bancária e a comissão. Por segurança, digite de novo o CPF/CNPJ
          ({recipient!.documentMasked}) e o número da conta ({recipient!.accountMasked}) para salvar.
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className="text-base font-bold text-ink">Quem recebe</legend>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1" role="radiogroup" aria-label="Tipo de recebedor">
          {(
            [
              ['individual', 'Pessoa física'],
              ['corporation', 'Empresa (CNPJ)'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={f.type === value}
              disabled={registered}
              onClick={() => set({ type: value })}
              className={`rounded-lg py-2 text-sm font-semibold transition disabled:opacity-60 ${
                f.type === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {input('rc-name', pj ? 'Razão social' : 'Nome completo', 'name', { autoComplete: 'name' })}
          {pj && input('rc-trading', 'Nome fantasia', 'tradingName')}
          {input('rc-document', pj ? 'CNPJ' : 'CPF', 'document', { inputMode: 'numeric', placeholder: registered ? `digite de novo (${recipient!.documentMasked})` : '' })}
          {input('rc-email', 'E-mail', 'email', { type: 'email', autoComplete: 'email' })}
          {input('rc-phone', 'Celular com DDD', 'phone', { inputMode: 'tel', autoComplete: 'tel-national' })}
          {input('rc-date', pj ? 'Data de fundação' : 'Data de nascimento', 'birthOrFoundingDate', { type: 'date' })}
          {input('rc-income', pj ? 'Faturamento anual (R$)' : 'Renda mensal (R$)', 'income', { inputMode: 'decimal' }, 'incomeCents')}
          {!pj && input('rc-occupation', 'Profissão', 'professionalOccupation')}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-bold text-ink">Endereço</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {input('rc-zip', 'CEP', 'zipCode', { inputMode: 'numeric', autoComplete: 'postal-code' })}
          <div className="col-span-2 sm:col-span-3">{input('rc-street', 'Rua', 'street', { autoComplete: 'address-line1' })}</div>
          {input('rc-number', 'Número', 'streetNumber')}
          {input('rc-complement', 'Complemento', 'complement')}
          <div className="col-span-2">{input('rc-neighborhood', 'Bairro', 'neighborhood')}</div>
          <div className="col-span-2 sm:col-span-3">{input('rc-city', 'Cidade', 'city')}</div>
          {input('rc-state', 'UF', 'state', { maxLength: 2 })}
        </div>
      </fieldset>

      {pj && (
        <fieldset className="space-y-3">
          <legend className="text-base font-bold text-ink">Sócio administrador</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {input('rc-p-name', 'Nome completo', 'partnerName', {}, 'partner.name')}
            {input('rc-p-cpf', 'CPF', 'partnerCpf', { inputMode: 'numeric' }, 'partner.cpf')}
            {input('rc-p-email', 'E-mail', 'partnerEmail', { type: 'email' }, 'partner.email')}
            {input('rc-p-birth', 'Data de nascimento', 'partnerBirthdate', { type: 'date' }, 'partner.birthdate')}
            {input('rc-p-income', 'Renda mensal (R$)', 'partnerIncome', { inputMode: 'decimal' }, 'partner.incomeCents')}
            {input('rc-p-occupation', 'Profissão', 'partnerOccupation', {}, 'partner.occupation')}
          </div>
          {err('partner') && <p className="text-xs font-medium text-danger">{err('partner')}</p>}
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="text-base font-bold text-ink">Conta para receber</legend>
        <p className="text-xs text-ink-muted">Precisa estar no mesmo CPF/CNPJ informado acima. Transferência automática todo dia.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">{input('rc-holder', 'Titular', 'bankHolderName')}</div>
          {input('rc-bank', 'Banco (3 dígitos)', 'bankCode', { inputMode: 'numeric', maxLength: 3, placeholder: 'ex.: 260' })}
          <Field id="rc-account-type" label="Tipo" error={err('accountType')}>
            <select id="rc-account-type" value={f.accountType} onChange={(e) => set({ accountType: e.target.value as 'checking' | 'savings' })} className="field">
              <option value="checking">Corrente</option>
              <option value="savings">Poupança</option>
            </select>
          </Field>
          {input('rc-branch', 'Agência', 'branchNumber', { inputMode: 'numeric', maxLength: 5 })}
          {input('rc-branch-dv', 'Dígito da agência', 'branchCheckDigit', { maxLength: 2 })}
          {input('rc-account', 'Conta', 'accountNumber', { inputMode: 'numeric', maxLength: 13, placeholder: registered ? `digite de novo (${recipient!.accountMasked})` : '' })}
          {input('rc-account-dv', 'Dígito da conta', 'accountCheckDigit', { maxLength: 2 })}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-bold text-ink">Comissão da plataforma</legend>
        <div className="max-w-xs">
          {input('rc-fee', 'Percentual (vazio = padrão do servidor)', 'feePercent', { type: 'number', min: 0, max: 100 })}
        </div>
        <p className="text-xs text-ink-muted">
          O lava-jato paga as taxas do Pix e do cartão, os centavos de arredondamento e responde por estornos e chargebacks.
        </p>
      </fieldset>

      {save.error && !(save.error instanceof ApiError && save.error.fieldErrors.length > 0) && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {save.error.message}
        </p>
      )}
      {save.error instanceof ApiError && save.error.fieldErrors.length > 0 && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          Confira os campos marcados.
        </p>
      )}

      <button type="submit" disabled={save.isPending} className="btn-primary">
        <Save className="h-4 w-4" aria-hidden="true" />
        {save.isPending ? 'Enviando…' : registered ? 'Salvar alterações' : 'Salvar e enviar ao Pagar.me'}
      </button>
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactElement }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {React.cloneElement(children, {
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? `${id}-error` : undefined,
      })}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
