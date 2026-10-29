import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { api, uploadFile } from '../lib/api';
import { compressImage } from '../lib/image';
import { formatPlate } from '../lib/format';
import { Appointment } from '../lib/types';

type Category = 'BEFORE' | 'AFTER';
type Photo = { id: string; category: Category };

const labels: Record<Category, string> = { BEFORE: 'Antes', AFTER: 'Depois' };

/**
 * Fotos de antes e depois do atendimento (equipe). As fotos ficam visíveis para o cliente no app
 * e as de depois podem ir junto no aviso de carro pronto pelo WhatsApp.
 */
export function PhotosModal({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<Category>('BEFORE');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appointment) return;
    setPhotos(appointment.photos);
    setCategory(appointment.photos.some((p) => p.category === 'BEFORE') ? 'AFTER' : 'BEFORE');
    setError(null);
  }, [appointment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!appointment) return null;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setProgress(`Enviando ${i + 1} de ${list.length}…`);
      try {
        const file = await compressImage(list[i]);
        const res = await uploadFile<{ photo: Photo }>(`/admin/appointments/${appointment.id}/photos`, file, { category });
        setPhotos((prev) => [...prev, res.photo]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao enviar a foto.');
        break;
      }
    }
    setProgress(null);
    queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  const remove = async (photo: Photo) => {
    if (!window.confirm('Remover esta foto? O cliente deixa de vê-la.')) return;
    try {
      await api(`/admin/photos/${photo.id}`, { method: 'DELETE' });
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover.');
    }
  };

  const visible = photos.filter((p) => p.category === category);

  return (
    <Modal
      open
      onClose={onClose}
      title="Fotos do atendimento"
      description={`${appointment.vehicleLabel} · ${formatPlate(appointment.vehiclePlate)}. O cliente vê as fotos no app.`}
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1" role="tablist" aria-label="Momento da foto">
          {(['BEFORE', 'AFTER'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={category === c}
              onClick={() => setCategory(c)}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                category === c ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {labels[c]} ({photos.filter((p) => p.category === c).length})
            </button>
          ))}
        </div>

        <label className="btn-primary w-full cursor-pointer focus-within:ring-2 focus-within:ring-accent">
          <Camera className="h-4 w-4" aria-hidden="true" />
          {progress ?? `Tirar ou escolher fotos de ${labels[category].toLowerCase()}`}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={Boolean(progress)}
            className="sr-only"
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {category === 'AFTER' && (
          <p className="text-xs text-ink-muted">
            As fotos de depois vão junto com o aviso de carro pronto no WhatsApp, se essa opção estiver ligada em Configurações.
          </p>
        )}

        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">
            Nenhuma foto de {labels[category].toLowerCase()} ainda.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {visible.map((photo, i) => (
              <li key={photo.id} className="relative overflow-hidden rounded-xl border border-line bg-subtle">
                <a href={`/api/v1/photos/${photo.id}`} target="_blank" rel="noopener noreferrer">
                  <img
                    src={`/api/v1/photos/${photo.id}`}
                    alt={`Foto de ${labels[category].toLowerCase()} ${i + 1}`}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                </a>
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  aria-label={`Remover foto de ${labels[category].toLowerCase()} ${i + 1}`}
                  className="absolute right-1.5 top-1.5 rounded-lg bg-surface/90 p-1.5 text-danger shadow hover:bg-surface"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Concluir</button>
        </div>
      </div>
    </Modal>
  );
}
