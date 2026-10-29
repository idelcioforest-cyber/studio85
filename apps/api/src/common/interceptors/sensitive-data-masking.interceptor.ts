import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { maskCPF } from '@autowash/shared';
import { decryptSensitiveData } from '../utils/crypto.util';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'emailverificationcode',
  'email_verification_code',
  'passwordresettoken',
  'password_reset_token',
  'cvv',
  'cardnumber',
  'card_number',
  'pan',
  'cpflookuphash',
  'cpf_lookup_hash',
]);

function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const cleaned: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_KEYS.has(lowerKey)) {
        continue; // Remove campos sensíveis da resposta
      }

      if (lowerKey === 'cpfencrypted' || lowerKey === 'cpf_encrypted') {
        try {
          if (typeof value === 'string' && value.includes(':')) {
            const decrypted = decryptSensitiveData(value);
            cleaned.cpf = maskCPF(decrypted);
          } else {
            cleaned.cpf = '***.***.***-**';
          }
        } catch {
          cleaned.cpf = '***.***.***-**';
        }
        continue;
      }

      cleaned[key] = sanitizeObject(value);
    }

    return cleaned;
  }

  return obj;
}

@Injectable()
export class SensitiveDataMaskingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => sanitizeObject(data)));
  }
}
