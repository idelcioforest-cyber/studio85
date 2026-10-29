import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock, MessageCircle, ArrowRight } from 'lucide-react';
import { VehicleSizeCategory } from '@autowash/shared';
import { SizeSelector } from '../components/SizeSelector';
import { useCatalog } from '../lib/queries';
import { formatPrice, formatDuration, sizeLabels, whatsappLink } from '../lib/format';

const steps = [
  { title: 'Escolha os serviços', text: 'Um ou mais, feitos no mesmo horário. Veja o valor e o tempo para o seu veículo.' },
  { title: 'Reserve um horário', text: 'Crie sua conta e escolha um horário livre na agenda.' },
  { title: 'Acompanhe pelo app', text: 'Saiba quando o carro entrar em lavagem e quando estiver pronto.' },
];

export default function CatalogPage() {
  const [size, setSize] = useState<VehicleSizeCategory>(VehicleSizeCategory.MEDIUM);
  const { data: categories = [], isLoading, isError } = useCatalog(size);

  return (
    <div className="space-y-12 animate-fadeIn">
      <section className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div className="max-w-2xl space-y-4">
          <p className="eyebrow">Estética automotiva · Porto Alegre</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Lavagem e estética automotiva com hora marcada
          </h1>
          <p className="text-base text-ink-muted">
            Consulte os valores para o seu veículo, escolha um horário livre e acompanhe o atendimento pelo app.
            Se preferir, fale com a gente pelo WhatsApp.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link to="/agenda" className="btn-primary">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Agendar horário
            </Link>
            <a
              href={whatsappLink('Olá! Gostaria de agendar um horário no Studio 85.')}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Agendar pelo WhatsApp
            </a>
          </div>
        </div>
        <img src="/logo.png" alt="" className="hidden h-40 w-40 object-contain md:block" />
      </section>

      <section aria-labelledby="servicos-titulo" className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="servicos-titulo" className="text-xl font-bold text-ink">Serviços e valores</h2>
            <p className="text-sm text-ink-muted">O valor e o tempo variam conforme o porte do veículo.</p>
          </div>
          <SizeSelector value={size} onChange={setSize} />
        </div>

        {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando serviços…</p>}
        {isError && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
            Não foi possível carregar os serviços agora. Tente novamente em instantes.
          </p>
        )}
        {!isLoading && !isError && categories.length === 0 && (
          <p className="card p-6 text-center text-sm text-ink-muted">
            Nenhum serviço disponível para {sizeLabels[size].toLowerCase()} no momento.
          </p>
        )}

        <div className="space-y-8">
          {categories.map((category) => (
            <div key={category.id} className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-ink-muted">{category.name}</h3>
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {category.services.map((service) => (
                  <li key={service.id} className="card flex flex-col justify-between gap-5 p-5">
                    <div className="space-y-1.5">
                      <h4 className="text-lg font-bold text-ink">{service.name}</h4>
                      {service.description && <p className="text-sm text-ink-muted">{service.description}</p>}
                    </div>
                    <div className="flex items-end justify-between gap-4 border-t border-line pt-4">
                      <div>
                        <p className="text-2xl font-extrabold text-ink">{formatPrice(service.priceCents)}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          Cerca de {formatDuration(service.durationMinutes)}
                          {service.isFlatPrice && ' · preço único'}
                        </p>
                      </div>
                      <Link
                        to={`/agenda?servico=${service.id}&porte=${size}`}
                        className="btn-primary"
                        aria-label={`Agendar ${service.name}`}
                      >
                        Agendar
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="como-funciona" className="space-y-4">
        <h2 id="como-funciona" className="text-xl font-bold text-ink">Como funciona</h2>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="card p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">
                {i + 1}
              </span>
              <h3 className="mt-3 font-bold text-ink">{step.title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-ink-muted">O pagamento é feito no local, na retirada do veículo.</p>
      </section>
    </div>
  );
}
