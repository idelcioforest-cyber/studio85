import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { api } from '../lib/api';
import { useMyAddresses, usePublicSettings } from '../lib/queries';

const emptyForm = {
  label: 'Casa',
  postalCode: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: 'Porto Alegre',
  state: 'RS',
  referencePoint: '',
  isDefault: false,
};

export default function AddressesPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { data: settings } = usePublicSettings();
  const { data: addresses = [], isLoading, isError } = useMyAddresses(true);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['addresses'] });

  const create = useMutation({
    mutationFn: () =>
      api('/addresses', {
        method: 'POST',
        body: {
          ...form,
          complement: form.complement.trim() || null,
          referencePoint: form.referencePoint.trim() || null,
        },
      }),
    onSuccess: () => {
      invalidate();
      setIsModalOpen(false);
      setForm(emptyForm);
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => api(`/addresses/${id}`, { method: 'PATCH', body: { isDefault: true } }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const update = (field: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const actionError = setDefault.error ?? remove.error;

  return (
    <div className="animate-fadeIn space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Meus endereços</h1>
          <p className="mt-1 text-sm text-ink-muted">Usados na Telebusca, quando buscamos e entregamos o seu carro.</p>
        </div>
        <button type="button" onClick={() => setIsModalOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo endereço
        </button>
      </header>

      {settings && !settings.telebuscaEnabled && (
        <p className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm text-info">
          A Telebusca está indisponível no momento. Seus endereços ficam salvos para quando ela voltar.
        </p>
      )}

      {actionError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {actionError.message}
        </p>
      )}

      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando endereços…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar seus endereços.
        </p>
      )}
      {!isLoading && !isError && addresses.length === 0 && (
        <div className="card p-8 text-center">
          <p className="font-semibold text-ink">Nenhum endereço cadastrado.</p>
        </div>
      )}

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {addresses.map((a) => (
          <li key={a.id} className={`card flex flex-col justify-between gap-4 p-5 ${a.isDefault ? 'border-accent' : ''}`}>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-bold text-ink">
                  <MapPin className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                  {a.label}
                </h2>
                {a.isDefault && (
                  <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-bold text-success">
                    Principal
                  </span>
                )}
              </div>
              <p className="text-sm text-ink">
                {a.street}, {a.number}
                {a.complement ? ` — ${a.complement}` : ''}
              </p>
              <p className="text-sm text-ink-muted">
                {a.neighborhood} · {a.city}/{a.state} · CEP {a.postalCode.replace(/^(\d{5})(\d{3})$/, '$1-$2')}
              </p>
              {a.referencePoint && <p className="text-sm text-ink-muted">Referência: {a.referencePoint}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              {!a.isDefault && (
                <button type="button" onClick={() => setDefault.mutate(a.id)} className="btn-secondary px-3 py-1.5">
                  Tornar principal
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Remover o endereço "${a.label}"?`)) remove.mutate(a.id);
                }}
                className="btn-danger px-3 py-1.5"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Novo endereço" size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-3.5"
        >
          {create.error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
              {create.error.message}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField id="addr-label" label="Nome (ex.: Casa, Trabalho)" value={form.label} onChange={update('label')} required />
            <TextField id="addr-cep" label="CEP" value={form.postalCode} onChange={update('postalCode')} inputMode="numeric" placeholder="00000-000" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <TextField id="addr-street" label="Rua" caps value={form.street} onChange={update('street')} required />
            </div>
            <TextField id="addr-number" label="Número" value={form.number} onChange={update('number')} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField id="addr-complement" label="Complemento" caps value={form.complement} onChange={update('complement')} />
            <TextField id="addr-neighborhood" label="Bairro" caps value={form.neighborhood} onChange={update('neighborhood')} required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <TextField id="addr-city" label="Cidade" caps value={form.city} onChange={update('city')} required />
            </div>
            <TextField id="addr-state" label="UF" value={form.state} onChange={update('state')} maxLength={2} required />
          </div>
          <TextField id="addr-ref" label="Ponto de referência" caps value={form.referencePoint} onChange={update('referencePoint')} />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.isDefault} onChange={update('isDefault')} className="h-4 w-4 accent-amber-500" />
            Usar como endereço principal
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={create.isPending} className="btn-primary">
              {create.isPending ? 'Salvando…' : 'Salvar endereço'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function TextField({
  id,
  label,
  caps,
  ...props
}: { id: string; label: string; caps?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} className={caps ? 'field field-caps' : 'field'} {...props} />
    </div>
  );
}
