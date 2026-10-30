import { NavLink } from 'react-router-dom';

const links = [
  { to: '/admin/financeiro', label: 'Caixa do dia' },
  { to: '/admin/receita', label: 'Receita' },
  { to: '/admin/pagamentos', label: 'Pagamentos online' },
];

/** Navegação entre as telas do financeiro */
export function FinanceNav() {
  return (
    <nav aria-label="Financeiro" className="flex gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end
          className={({ isActive }) =>
            `flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm font-semibold transition ${
              isActive ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
