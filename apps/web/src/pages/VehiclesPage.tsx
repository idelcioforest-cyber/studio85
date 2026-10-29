import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { VehicleForm } from '../components/VehicleForm';
import { api } from '../lib/api';
import { useMyVehicles } from '../lib/queries';
import { formatPlate, sizeLabels } from '../lib/format';

export default function VehiclesPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { data: vehicles = [], isLoading, isError } = useMyVehicles(true);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/vehicles/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
  });

  return (
    <div className="animate-fadeIn space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Minha garagem</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Os veículos cadastrados aparecem na hora de agendar. O porte define o valor do serviço.
          </p>
        </div>
        <button type="button" onClick={() => setIsModalOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Adicionar veículo
        </button>
      </header>

      {remove.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {remove.error.message}
        </p>
      )}

      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando veículos…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar sua garagem. Tente novamente em instantes.
        </p>
      )}

      {!isLoading && !isError && vehicles.length === 0 && (
        <div className="card p-8 text-center">
          <p className="font-semibold text-ink">Nenhum veículo cadastrado.</p>
          <p className="mt-1 text-sm text-ink-muted">Cadastre seu carro para agendar mais rápido.</p>
        </div>
      )}

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {vehicles.map((v) => (
          <li key={v.id} className="card flex flex-col justify-between gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{v.make}</p>
                <h2 className="text-lg font-bold text-ink">{v.model}</h2>
              </div>
              <span className="rounded-md border-2 border-ink px-2.5 py-0.5 font-mono text-sm font-bold tracking-wider text-ink">
                {formatPlate(v.plate)}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm">
              <div>
                <dt className="text-xs text-ink-muted">Porte</dt>
                <dd className="font-semibold text-ink">{sizeLabels[v.sizeCategory]}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Cor</dt>
                <dd className="font-semibold text-ink">{v.color || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Ano</dt>
                <dd className="font-semibold text-ink">{v.year || '—'}</dd>
              </div>
            </dl>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Remover ${v.make} ${v.model} da sua garagem?`)) remove.mutate(v.id);
                }}
                disabled={remove.isPending && remove.variables === v.id}
                className="btn-danger px-3 py-1.5"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Adicionar veículo"
        description="Informe os dados do veículo que será atendido."
      >
        <VehicleForm onSaved={() => setIsModalOpen(false)} onCancel={() => setIsModalOpen(false)} />
      </Modal>
    </div>
  );
}
