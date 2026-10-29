import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateServiceCategoryInput,
  UpdateServiceCategoryInput,
  CreateServiceInput,
  UpdateServiceInput,
  VehicleSizeCategory,
} from '@autowash/shared';
import { resolveServicePricing } from './pricing.util';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Catálogo público: lista categorias ativas e serviços ativos
   * Se informado o porte do veículo, calcula o preço e a duração específicos daquela categoria
   */
  async findAllPublic(sizeCategory?: VehicleSizeCategory) {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        services: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          include: {
            priceRules: true,
          },
        },
      },
    });

    return categories
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        icon: cat.icon,
        services: cat.services.flatMap((svc) => {
          // Serviço com preço por porte que não atende o porte escolhido fica fora da lista
          const pricing = resolveServicePricing(svc, sizeCategory);
          if (!pricing) return [];

          return [
            {
              id: svc.id,
              name: svc.name,
              description: svc.description,
              priceCents: pricing.priceCents,
              durationMinutes: pricing.durationMinutes,
              basePriceCents: svc.basePriceCents,
              baseDurationMinutes: svc.baseDurationMinutes,
              isFlatPrice: svc.priceRules.length === 0,
              priceRules: svc.priceRules.map((r) => ({
                sizeCategory: r.sizeCategory,
                priceCents: r.priceCents,
                durationMinutes: r.durationMinutes,
              })),
            },
          ];
        }),
      }))
      .filter((cat) => cat.services.length > 0);
  }

  /**
   * Lista administrativa: inclui serviços e categorias pausados
   */
  async adminFindAll() {
    return this.prisma.serviceCategory.findMany({
      orderBy: { displayOrder: 'asc' },
      include: {
        services: {
          orderBy: { displayOrder: 'asc' },
          include: { priceRules: true },
        },
      },
    });
  }

  async findServiceById(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        category: true,
        priceRules: true,
      },
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    return service;
  }

  // --- Operações Administrativas de Categorias ---

  async createCategory(input: CreateServiceCategoryInput) {
    return this.prisma.serviceCategory.create({
      data: {
        name: input.name,
        description: input.description || null,
        icon: input.icon || null,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
      },
    });
  }

  async updateCategory(id: string, input: UpdateServiceCategoryInput) {
    const category = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoria não encontrada.');

    return this.prisma.serviceCategory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  async deleteCategory(id: string) {
    const hasServices = await this.prisma.service.count({ where: { categoryId: id } });
    if (hasServices > 0) {
      throw new ConflictException(
        'Não é possível excluir uma categoria que possui serviços vinculados. Desative-a ou mova os serviços.',
      );
    }

    return this.prisma.serviceCategory.delete({ where: { id } });
  }

  // --- Operações Administrativas de Serviços ---

  async createService(input: CreateServiceInput) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: input.categoryId },
    });
    if (!category) throw new NotFoundException('Categoria informada não existe.');

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.service.create({
        data: {
          categoryId: input.categoryId,
          name: input.name,
          description: input.description || null,
          basePriceCents: input.basePriceCents,
          baseDurationMinutes: input.baseDurationMinutes,
          isActive: input.isActive,
          displayOrder: input.displayOrder,
        },
      });

      if (input.priceRules && input.priceRules.length > 0) {
        await tx.servicePriceRule.createMany({
          data: input.priceRules.map((r) => ({
            serviceId: service.id,
            sizeCategory: r.sizeCategory,
            priceCents: r.priceCents,
            durationMinutes: r.durationMinutes,
          })),
        });
      }

      return tx.service.findUnique({
        where: { id: service.id },
        include: { category: true, priceRules: true },
      });
    });
  }

  async updateService(id: string, input: UpdateServiceInput) {
    await this.findServiceById(id);

    return this.prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { id },
        data: {
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.basePriceCents !== undefined ? { basePriceCents: input.basePriceCents } : {}),
          ...(input.baseDurationMinutes !== undefined ? { baseDurationMinutes: input.baseDurationMinutes } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        },
      });

      if (input.priceRules) {
        // Substitui regras de preço com integridade
        await tx.servicePriceRule.deleteMany({ where: { serviceId: id } });
        if (input.priceRules.length > 0) {
          await tx.servicePriceRule.createMany({
            data: input.priceRules.map((r) => ({
              serviceId: id,
              sizeCategory: r.sizeCategory,
              priceCents: r.priceCents,
              durationMinutes: r.durationMinutes,
            })),
          });
        }
      }

      return tx.service.findUnique({
        where: { id },
        include: { category: true, priceRules: true },
      });
    });
  }

  async deleteService(id: string) {
    await this.findServiceById(id);

    // Desativação em vez de delete rígido para proteger ordens de serviço históricas
    return this.prisma.service.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
