import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip, headers, user } = request;

    // Registra mutações (POST, PUT, PATCH, DELETE)
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isLogin = url.includes('/auth/login');
    // Nas rotas de conta, "code" é o código enviado por e-mail (verificação ou nova senha)
    const maskCode = url.includes('/auth/');

    return next.handle().pipe(
      tap(async (responseBody) => {
        if (isMutation && !isLogin) {
          try {
            const authUser = user as AuthenticatedUser | undefined;
            const action = `${method} ${url}`;
            const userAgent = headers['user-agent']?.slice(0, 255);

            await this.prisma.auditLog.create({
              data: {
                userId: authUser?.id || null,
                action: action.slice(0, 80),
                resource: url.split('/')[2] || 'general',
                resourceId: request.params?.id || null,
                ipAddress: ip?.slice(0, 45),
                userAgent,
                diffBeforeJson: request.body ? JSON.stringify(this.sanitizeBody(request.body, maskCode)) : null,
                diffAfterJson: responseBody ? JSON.stringify(this.sanitizeBody(responseBody, maskCode)) : null,
              },
            });
          } catch (err) {
            this.logger.error('Falha ao gravar trilha de auditoria:', err);
          }
        }
      }),
    );
  }

  // Campos que nunca podem ir para a trilha de auditoria (senhas, senha provisória, CPF, tokens e códigos)
  private static readonly MASKED_KEYS = new Set([
    'cpf',
    'accesstoken',
    'token',
    'devverificationcode',
    'verificationcode',
    'devresetcode',
  ]);

  private sanitizeBody(body: any, maskCode = false, depth = 0): any {
    if (!body || typeof body !== 'object' || depth > 4) return body;
    if (Array.isArray(body)) return body.map((item) => this.sanitizeBody(item, maskCode, depth + 1));

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      const lower = key.toLowerCase();
      sanitized[key] =
        lower.includes('password') || AuditLogInterceptor.MASKED_KEYS.has(lower) || (maskCode && lower === 'code')
          ? '[MASKED]'
          : this.sanitizeBody(value, maskCode, depth + 1);
    }
    return sanitized;
  }
}
