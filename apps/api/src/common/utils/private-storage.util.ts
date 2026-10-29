import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Armazenamento privado de arquivos (comprovantes e fotos). Nada aqui é servido por URL pública:
 * a API entrega o arquivo só depois de checar quem está pedindo.
 */

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

type DetectedType = { mime: string; ext: string };

// Tipos identificados pelos bytes iniciais do arquivo (não pela extensão ou pelo MIME informado)
const IMAGE_TYPES = [
  { mime: 'image/jpeg', ext: 'jpg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    ext: 'png',
    matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    matches: (b: Buffer) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

const PDF_TYPE = { mime: 'application/pdf', ext: 'pdf', matches: (b: Buffer) => b.subarray(0, 5).toString('ascii') === '%PDF-' };

function detect(buffer: Buffer, types: typeof IMAGE_TYPES): DetectedType | null {
  const type = types.find((t) => t.matches(buffer));
  return type ? { mime: type.mime, ext: type.ext } : null;
}

/** Comprovante: foto ou PDF */
export function detectReceiptType(buffer: Buffer): DetectedType | null {
  return detect(buffer, [...IMAGE_TYPES, PDF_TYPE]);
}

/** Foto do atendimento: somente imagem */
export function detectImageType(buffer: Buffer): DetectedType | null {
  return detect(buffer, IMAGE_TYPES);
}

function storageRoot(): string {
  return path.resolve(process.env.STORAGE_LOCAL_PATH || './storage/uploads');
}

/**
 * Caminho absoluto de uma chave interna, sempre dentro da pasta de armazenamento
 */
export function resolveStoragePath(storageKey: string): string {
  const root = storageRoot();
  const fullPath = path.resolve(root, storageKey);
  if (!fullPath.startsWith(root + path.sep)) {
    throw new Error('Caminho de armazenamento inválido');
  }
  return fullPath;
}

/**
 * Grava o arquivo com nome aleatório gerado no servidor e devolve a chave interna
 */
export async function saveStoredFile(folder: 'receipts' | 'photos', buffer: Buffer, ext: string): Promise<string> {
  const storageKey = `${folder}/${randomUUID()}.${ext}`;
  const fullPath = resolveStoragePath(storageKey);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer, { flag: 'wx' });
  return storageKey;
}

export async function deleteStoredFile(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return;
  try {
    await fs.unlink(resolveStoragePath(storageKey));
  } catch {
    // Arquivo já removido: nada a fazer
  }
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return fs.readFile(resolveStoragePath(storageKey));
}
