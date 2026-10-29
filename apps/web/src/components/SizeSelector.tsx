import { VehicleSizeCategory } from '@autowash/shared';
import { publicSizes, sizeLabels, sizeExamples } from '../lib/format';

interface SizeSelectorProps {
  value: VehicleSizeCategory;
  onChange: (size: VehicleSizeCategory) => void;
  label?: string;
}

/**
 * Seletor compacto de porte do veículo (grupo de opções acessível)
 */
export function SizeSelector({ value, onChange, label = 'Porte do veículo' }: SizeSelectorProps) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1 sm:inline-grid sm:grid-cols-4">
        {publicSizes.map((size) => {
          const selected = value === size;
          return (
            <label
              key={size}
              className={`cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-semibold transition focus-within:ring-2 focus-within:ring-accent ${
                selected ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <input
                type="radio"
                name="vehicle-size"
                value={size}
                checked={selected}
                onChange={() => onChange(size)}
                className="sr-only"
              />
              {sizeLabels[size]}
            </label>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">Ex.: {sizeExamples[value]}</p>
    </fieldset>
  );
}
