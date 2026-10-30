import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { VehicleSizeCategory, isValidBrazilianPlate } from '@autowash/shared';
import { api, ApiError } from '../lib/api';
import { publicSizes, sizeLabels } from '../lib/format';
import { Vehicle } from '../lib/types';

interface VehicleFormProps {
  defaultSize?: VehicleSizeCategory;
  onSaved: (vehicle: Vehicle) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

export function VehicleForm({ defaultSize = VehicleSizeCategory.MEDIUM, onSaved, onCancel, submitLabel = 'Salvar veículo' }: VehicleFormProps) {
  const queryClient = useQueryClient();
  const [hasPlate, setHasPlate] = useState(true);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [sizeCategory, setSizeCategory] = useState<VehicleSizeCategory>(defaultSize);
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api<{ vehicle: Vehicle }>('/vehicles', {
        method: 'POST',
        body: {
          plate: hasPlate ? plate : null,
          make: make.trim(),
          model: model.trim(),
          year: year ? Number(year) : null,
          color: color.trim() || null,
          sizeCategory,
        },
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      onSaved(data.vehicle);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (hasPlate && !isValidBrazilianPlate(plate)) {
      setLocalError('Informe uma placa válida (Mercosul ABC1D23 ou antiga ABC-1234).');
      return;
    }
    save.mutate();
  };

  const error = localError ?? (save.error instanceof ApiError ? save.error.message : null);

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="veh-make" className="label">Marca</label>
          <input id="veh-make" required value={make} onChange={(e) => setMake(e.target.value)} placeholder="Honda" className="field field-caps" />
        </div>
        <div>
          <label htmlFor="veh-model" className="label">Modelo</label>
          <input id="veh-model" required value={model} onChange={(e) => setModel(e.target.value)} placeholder="Civic" className="field field-caps" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="veh-plate" className="label">Placa</label>
          <input
            id="veh-plate"
            value={plate}
            disabled={!hasPlate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder={hasPlate ? 'ABC1D23' : 'Sem placa'}
            maxLength={8}
            className="field font-mono uppercase disabled:opacity-60"
          />
          <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={!hasPlate}
              onChange={(e) => setHasPlate(!e.target.checked)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            Veículo ainda sem placa
          </label>
        </div>
        <div>
          <label htmlFor="veh-size" className="label">Porte</label>
          <select
            id="veh-size"
            value={sizeCategory}
            onChange={(e) => setSizeCategory(e.target.value as VehicleSizeCategory)}
            className="field"
          >
            {publicSizes.map((s) => (
              <option key={s} value={s}>{sizeLabels[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="veh-year" className="label">Ano <span className="font-normal text-ink-muted">(opcional)</span></label>
          <input id="veh-year" type="number" inputMode="numeric" min={1950} value={year} onChange={(e) => setYear(e.target.value)} className="field" />
        </div>
        <div>
          <label htmlFor="veh-color" className="label">Cor <span className="font-normal text-ink-muted">(opcional)</span></label>
          <input id="veh-color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="Preto" className="field field-caps" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={save.isPending} className="btn-primary">
          {save.isPending ? 'Salvando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
