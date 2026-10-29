import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressInput, UpdateAddressInput, UserRole } from '@autowash/shared';

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cadastra novo endereço vinculado ao cliente
   */
  async create(userId: string, input: CreateAddressInput) {
    // Se o novo endereço é marcado como padrão, desmarca os anteriores
    if (input.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    } else {
      // Se for o primeiro endereço do usuário, define automaticamente como padrão
      const count = await this.prisma.address.count({ where: { userId } });
      if (count === 0) {
        input.isDefault = true;
      }
    }

    const address = await this.prisma.address.create({
      data: {
        userId,
        label: input.label,
        street: input.street,
        number: input.number,
        complement: input.complement || null,
        neighborhood: input.neighborhood,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        referencePoint: input.referencePoint || null,
        isDefault: input.isDefault,
      },
    });

    return {
      success: true,
      message: 'Endereço cadastrado com sucesso.',
      address,
    };
  }

  /**
   * Lista todos os endereços do usuário autenticado (Anti-IDOR)
   */
  async findMyAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Busca um endereço por ID com validação de propriedade (Anti-IDOR)
   */
  async findById(id: string, user: { id: string; roles: string[] }) {
    const address = await this.prisma.address.findUnique({
      where: { id },
    });

    if (!address) {
      throw new NotFoundException('Endereço não encontrado.');
    }

    const isAdmin = user.roles.includes(UserRole.ADMIN) || user.roles.includes(UserRole.MANAGER);
    if (!isAdmin && address.userId !== user.id) {
      throw new ForbiddenException('Acesso negado: este endereço pertence a outro usuário.');
    }

    return address;
  }

  /**
   * Atualização de endereço (Anti-IDOR)
   */
  async update(id: string, user: { id: string; roles: string[] }, input: UpdateAddressInput) {
    const existing = await this.findById(id, user);

    if (input.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId: existing.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const updated = await this.prisma.address.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.street !== undefined ? { street: input.street } : {}),
        ...(input.number !== undefined ? { number: input.number } : {}),
        ...(input.complement !== undefined ? { complement: input.complement } : {}),
        ...(input.neighborhood !== undefined ? { neighborhood: input.neighborhood } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
        ...(input.referencePoint !== undefined ? { referencePoint: input.referencePoint } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
    });

    return {
      success: true,
      message: 'Endereço atualizado com sucesso.',
      address: updated,
    };
  }

  /**
   * Exclusão de endereço (Anti-IDOR)
   */
  async remove(id: string, user: { id: string; roles: string[] }) {
    await this.findById(id, user);

    await this.prisma.address.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Endereço removido com sucesso.',
    };
  }
}
