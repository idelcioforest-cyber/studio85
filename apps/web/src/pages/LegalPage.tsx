import { Link } from 'react-router-dom';
import { LegalDocumentBody, LegalSlug } from '../components/LegalDocument';

const related: Record<LegalSlug, { to: string; label: string }[]> = {
  terms_of_use: [
    { to: '/privacidade', label: 'Política de Privacidade' },
    { to: '/cancelamento', label: 'Política de Cancelamento' },
  ],
  privacy_policy: [
    { to: '/termos', label: 'Termos de Uso' },
    { to: '/cancelamento', label: 'Política de Cancelamento' },
  ],
  cancellation_policy: [
    { to: '/termos', label: 'Termos de Uso' },
    { to: '/privacidade', label: 'Política de Privacidade' },
  ],
};

export default function LegalPage({ slug }: { slug: LegalSlug }) {
  return (
    <div className="animate-fadeIn mx-auto max-w-3xl space-y-8">
      <div className="card p-6 sm:p-8">
        <LegalDocumentBody slug={slug} />
      </div>
      <nav aria-label="Outros documentos" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {related[slug].map((link) => (
          <Link key={link.to} to={link.to} className="font-semibold text-accent-text underline">
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
