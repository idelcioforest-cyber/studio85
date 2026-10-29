import {
  hashPassword,
  verifyPassword,
  encryptSensitiveData,
  decryptSensitiveData,
  generateLookupHash,
  timingSafeCompare,
  generateSecureCode,
} from '../src/common/utils/crypto.util';

describe('Crypto Utilities (ForestSecurity Compliance)', () => {
  describe('Argon2id Password Hashing', () => {
    it('deve gerar hash Argon2id válido e verificar corretamente a senha', async () => {
      const password = 'MinhaSenhaForte@2026';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash.startsWith('$argon2id$')).toBe(true);

      const isValid = await verifyPassword(hash, password);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword(hash, 'SenhaIncorreta');
      expect(isInvalid).toBe(false);
    });
  });

  describe('AES-256-GCM Sensitive Data Encryption (CPF)', () => {
    it('deve criptografar e descriptografar dados confidenciais com autenticação de integridade', () => {
      const cpf = '12345678901';
      const encrypted = encryptSensitiveData(cpf);

      expect(encrypted).toBeDefined();
      expect(encrypted).toContain(':'); // formato iv:authTag:ciphertext

      const decrypted = decryptSensitiveData(encrypted);
      expect(decrypted).toBe(cpf);
    });

    it('deve falhar se o payload criptográfico for violado', () => {
      const encrypted = encryptSensitiveData('12345678901');
      const tampered = encrypted.slice(0, -4) + 'abcd';

      expect(() => decryptSensitiveData(tampered)).toThrow();
    });
  });

  describe('Lookup Hash (Blind Indexing)', () => {
    it('deve gerar hash determinístico consistente para buscas indexadas', () => {
      const cpf = '12345678901';
      const hash1 = generateLookupHash(cpf);
      const hash2 = generateLookupHash(cpf);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });
  });

  describe('Timing-safe comparison', () => {
    it('deve comparar strings em tempo constante sem vulnerabilidade de timing', () => {
      expect(timingSafeCompare('123456', '123456')).toBe(true);
      expect(timingSafeCompare('123456', '654321')).toBe(false);
      expect(timingSafeCompare('123', '123456')).toBe(false);
    });
  });

  describe('Secure Code Generation', () => {
    it('deve gerar código numérico de 6 dígitos', () => {
      const code = generateSecureCode();
      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });
  });
});
