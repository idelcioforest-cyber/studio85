import { Test, TestingModule } from '@nestjs/testing';
import { ServicesService } from '../src/modules/services/services.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { VehicleSizeCategory } from '@autowash/shared';

describe('ServicesService (Integration & Dynamic Pricing Tests)', () => {
  let servicesService: ServicesService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ServicesService, PrismaService],
    }).compile();

    servicesService = module.get<ServicesService>(ServicesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. Deve listar categorias e serviços no catálogo público', async () => {
    const catalog = await servicesService.findAllPublic();
    expect(catalog).toBeDefined();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it('2. Deve aplicar precificação dinâmica conforme o porte do veículo', async () => {
    // Busca catálogo para porte SUV
    const catalogSUV = await servicesService.findAllPublic(VehicleSizeCategory.SUV);
    const lavagemSvc = catalogSUV[0]?.services.find((s) => s.name === 'Lavagem Simples');

    if (lavagemSvc) {
      // No seed, Lavagem Simples SUV é R$ 80,00 (8000 centavos) em 1h45
      expect(lavagemSvc.priceCents).toBe(8000);
      expect(lavagemSvc.durationMinutes).toBe(105);
    }

    // Busca catálogo para porte SMALL
    const catalogSmall = await servicesService.findAllPublic(VehicleSizeCategory.SMALL);
    const lavagemSmall = catalogSmall[0]?.services.find((s) => s.name === 'Lavagem Simples');

    if (lavagemSmall) {
      // No seed, Lavagem Simples SMALL é R$ 60,00 (6000 centavos) em 1h15
      expect(lavagemSmall.priceCents).toBe(6000);
      expect(lavagemSmall.durationMinutes).toBe(75);
    }
  });

  it('3. Admin deve criar novo serviço com regras por porte', async () => {
    const category = await prisma.serviceCategory.findFirst();
    expect(category).toBeDefined();

    const created = await servicesService.createService({
      categoryId: category!.id,
      name: 'Polimento Técnico Premium',
      description: 'Remoção de micro-riscos e proteção sintética.',
      basePriceCents: 35000, // R$ 350,00
      baseDurationMinutes: 180,
      isActive: true,
      displayOrder: 10,
      priceRules: [
        { sizeCategory: VehicleSizeCategory.SMALL, priceCents: 30000, durationMinutes: 150 },
        { sizeCategory: VehicleSizeCategory.SUV, priceCents: 42000, durationMinutes: 240 },
      ],
    });

    expect(created).toBeDefined();
    expect(created?.name).toBe('Polimento Técnico Premium');
    expect(created?.priceRules.length).toBe(2);

    // Limpeza
    await prisma.servicePriceRule.deleteMany({ where: { serviceId: created!.id } });
    await prisma.service.delete({ where: { id: created!.id } });
  });
});
