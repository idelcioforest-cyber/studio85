import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVehicleInput, UpdateVehicleInput, UserRole, cleanPlate } from '@autowash/shared';
import * as crypto from 'crypto';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Gera código interno legível para o veículo (ex: VH-A1B2)
   */
  private generateInternalCode(): string {
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `VH-${randomHex}`;
  }

  /**
   * Criação de veículo associado ao usuário logado
   */
  async create(userId: string, input: CreateVehicleInput) {
    const cleanedPlate = input.plate ? cleanPlate(input.plate) : null;

    // Se a placa foi informada, valida se já não está cadastrada e ativa para outro usuário
    if (cleanedPlate) {
      const existingVehicle = await this.prisma.vehicle.findFirst({
        where: {
          plate: cleanedPlate,
          status: 'ACTIVE',
        },
      });

      if (existingVehicle) {
        if (existingVehicle.userId === userId) {
          throw new ConflictException('Você já cadastrou este veículo em sua garagem.');
        } else {
          throw new ConflictException(
            'Esta placa já está vinculada a outro cadastro. Para transferência, contate o atendimento.',
          );
        }
      }
    }

    const internalCode = this.generateInternalCode();

    const vehicle = await this.prisma.vehicle.create({
      data: {
        userId,
        plate: cleanedPlate || null,
        internalCode,
        make: input.make,
        model: input.model,
        year: input.year || null,
        color: input.color || null,
        sizeCategory: input.sizeCategory,
        notes: input.notes || null,
        status: 'ACTIVE',
      },
    });

    return {
      success: true,
      message: 'Veículo cadastrado com sucesso.',
      vehicle,
    };
  }

  /**
   * Lista todos os veículos ativos do usuário autenticado (Anti-IDOR)
   */
  async findMyVehicles(userId: string) {
    return this.prisma.vehicle.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Busca um veículo por ID com validação de propriedade (Anti-IDOR)
   */
  async findById(id: string, user: { id: string; roles: string[] }) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!vehicle || vehicle.status === 'INACTIVE') {
      throw new NotFoundException('Veículo não encontrado.');
    }

    const isAdminOrStaff =
      user.roles.includes(UserRole.ADMIN) ||
      user.roles.includes(UserRole.MANAGER) ||
      user.roles.includes(UserRole.ATTENDANT);

    if (!isAdminOrStaff && vehicle.userId !== user.id) {
      throw new ForbiddenException('Acesso negado: este veículo não pertence à sua conta.');
    }

    return vehicle;
  }

  /**
   * Atualização de dados do veículo (Anti-IDOR)
   */
  async update(id: string, user: { id: string; roles: string[] }, input: UpdateVehicleInput) {
    await this.findById(id, user); // Valida existência e propriedade

    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(input.plate !== undefined ? { plate: input.plate } : {}),
        ...(input.make !== undefined ? { make: input.make } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.year !== undefined ? { year: input.year } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.sizeCategory !== undefined ? { sizeCategory: input.sizeCategory } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    return {
      success: true,
      message: 'Veículo atualizado com sucesso.',
      vehicle: updated,
    };
  }

  /**
   * Exclusão lógica (soft-delete) do veículo (Anti-IDOR)
   */
  async remove(id: string, user: { id: string; roles: string[] }) {
    await this.findById(id, user); // Valida existência e propriedade

    await this.prisma.vehicle.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    return {
      success: true,
      message: 'Veículo removido da sua garagem com sucesso.',
    };
  }

  /**
   * Busca administrativa com filtros (apenas funcionários autorizados)
   */
  async adminFindAll(search?: string, sizeCategory?: any) {
    return this.prisma.vehicle.findMany({
      where: {
        status: 'ACTIVE',
        ...(sizeCategory ? { sizeCategory } : {}),
        ...(search
          ? {
              OR: [
                { plate: { contains: search } },
                { internalCode: { contains: search } },
                { model: { contains: search } },
                { make: { contains: search } },
                { user: { name: { contains: search } } },
                { user: { phone: { contains: search } } },
              ],
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
