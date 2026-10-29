import { Injectable, CanActivate, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '@autowash/shared';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Guard Anti-IDOR (Insecure Direct Object Reference)
 * Conforme forestsecurity.md:
 * "Toda requisição deve conferir que o recurso pertence a quem está pedindo.
 * 200 para recurso alheio é falha; 403 ou 404 é o esperado."
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException('Acesso negado: usuário não autenticado');
    }

    // Administradores e gerentes têm acesso autorizado aos recursos para fins operacionais
    if (user.roles.includes(UserRole.ADMIN) || user.roles.includes(UserRole.MANAGER)) {
      return true;
    }

    // Se houver um parâmetro userId na rota, deve bater exatamente com o usuário logado
    if (request.params.userId && request.params.userId !== user.id) {
      throw new ForbiddenException('Acesso negado: você não tem permissão para acessar os dados de outro usuário');
    }

    // Validação de veículo próprio se houver :vehicleId ou :id em rotas de veículos
    if (request.params.vehicleId) {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: request.params.vehicleId },
        select: { userId: true },
      });
      if (!vehicle) {
        throw new NotFoundException('Veículo não encontrado');
      }
      if (vehicle.userId !== user.id) {
        throw new ForbiddenException('Acesso negado: este veículo não pertence à sua conta');
      }
    }

    // Validação de agendamento próprio se houver :appointmentId ou :id em rotas de agendamento
    if (request.params.appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: request.params.appointmentId },
        select: { userId: true },
      });
      if (!appointment) {
        throw new NotFoundException('Agendamento não encontrado');
      }
      if (appointment.userId !== user.id) {
        throw new ForbiddenException('Acesso negado: este agendamento não pertence à sua conta');
      }
    }

    return true;
  }
}
