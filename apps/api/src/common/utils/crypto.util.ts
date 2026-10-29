import * as crypto from 'crypto';
import * as argon2 from '@node-rs/argon2';

/**
 * Utilitários criptográficos em conformidade com forestsecurity.md
 */

// Chave mestra de 32 bytes (256 bits) para AES-256-GCM
function getEncryptionKey(): Buffer {
  const hexKey = process.env.DATA_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  return Buffer.from(hexKey, 'hex');
}

function getLookupSalt(): string {
  return process.env.DATA_ENCRYPTION_SALT || 'autowash_cpf_lookup_salt_default';
}

/**
 * Hash de senha usando Argon2id (Requisito obrigatório do ForestSecurity)
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    memoryCost: 65536, // 64 MB
    timeCost: 3,       // 3 iterações
    outputLen: 32,
    parallelism: 1,
    algorithm: argon2.Algorithm.Argon2id,
  });
}

/**
 * Verificação de senha com Argon2id
 */
export async function verifyPassword(hash: string, plainText: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainText);
  } catch {
    return false;
  }
}

/**
 * Criptografa dados em repouso usando AES-256-GCM (ex: CPF do cliente)
 * Retorna string serializada: iv:authTag:ciphertext (em formato hex)
 */
export function encryptSensitiveData(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Descriptografa dados confidenciais protegidos com AES-256-GCM
 */
export function decryptSensitiveData(encryptedPayload: string): string {
  try {
    const [ivHex, authTagHex, cipherTextHex] = encryptedPayload.split(':');
    if (!ivHex || !authTagHex || !cipherTextHex) {
      throw new Error('Payload criptográfico malformatado');
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const cipherText = Buffer.from(cipherTextHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error('Falha na descriptografia de dado protegido');
  }
}

/**
 * Gera hash cego determinístico (HMAC-SHA256) para possibilitar busca por CPF
 * sem descriptografar registros e sem expor o CPF em texto claro no banco.
 */
export function generateLookupHash(plainText: string): string {
  const salt = getLookupSalt();
  return crypto.createHmac('sha256', salt).update(plainText.trim()).digest('hex');
}

/**
 * Comparação em tempo constante para prevenir ataques de temporização (Timing Attacks)
 */
export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Gera código numérico de 6 dígitos criptograficamente seguro para verificação de e-mail
 */
export function generateSecureCode(): string {
  const randomInt = crypto.randomInt(100000, 999999);
  return randomInt.toString();
}
