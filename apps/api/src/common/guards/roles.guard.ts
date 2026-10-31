import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@autowash/shared';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Se a rota não exige papéis específicos, passa
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    // Negação por padrão: se não há usuário autenticado com roles, bloqueia
    if (!user || !user.roles || user.roles.length === 0) {
      throw new ForbiddenException('Acesso negado: credenciais insuficientes');
    }

    // Área do dono da plataforma: exclusiva, o administrador do lava-jato não entra
    if (requiredRoles.includes(UserRole.SUPER_ADMIN)) {
      if (user.roles.includes(UserRole.SUPER_ADMIN)) return true;
      throw new ForbiddenException('Acesso negado: área exclusiva do dono da plataforma');
    }

    // Administrador tem acesso amplo funcional
    if (user.roles.includes(UserRole.ADMIN)) {
      return true;
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException('Acesso negado: seu papel não tem permissão para esta operação');
    }

    return true;
  }
}
