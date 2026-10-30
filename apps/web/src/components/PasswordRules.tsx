import { Check, Circle } from 'lucide-react';

// Mesmas regras do RegisterSchema/ResetPasswordSchema (packages/shared)
const RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: '8 ou mais caracteres', test: (v) => v.length >= 8 },
  { label: '1 letra maiúscula (A-Z)', test: (v) => /[A-Z]/.test(v) },
  { label: '1 letra minúscula (a-z)', test: (v) => /[a-z]/.test(v) },
  { label: '1 número (0-9)', test: (v) => /[0-9]/.test(v) },
  { label: '1 símbolo (ex.: @ # ! ?)', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export const passwordMeetsRules = (value: string) => RULES.every((rule) => rule.test(value));

/** Lista fora do campo de senha que vai marcando cada regra conforme a pessoa digita */
export function PasswordRules({ id, value }: { id: string; value: string }) {
  return (
    <div id={id} className="mt-2 rounded-xl border border-line bg-subtle px-3 py-2.5">
      <p className="text-xs font-semibold text-ink">A senha precisa ter:</p>
      <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <li key={rule.label} className={`flex items-center gap-1.5 text-xs ${ok ? 'font-semibold text-success' : 'text-ink-muted'}`}>
              {ok ? (
                <Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
              )}
              {rule.label}
              <span className="sr-only">{ok ? '(atendido)' : '(falta)'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
