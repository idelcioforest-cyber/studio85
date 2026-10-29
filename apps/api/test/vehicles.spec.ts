import { Test, TestingModule } from '@nestjs/testing';
import { VehiclesService } from '../src/modules/vehicles/vehicles.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { VehicleSizeCategory, UserRole } from '@autowash/shared';
import { ForbiddenException, ConflictException } from '@nestjs/common';

describe('VehiclesService (Integration & Anti-IDOR Tests)', () => {
  let vehiclesService: VehiclesService;
  let prisma: PrismaService;

  let clientAId: string;
  let clientBId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VehiclesService, PrismaService],
    }).compile();

    vehiclesService = module.get<VehiclesService>(VehiclesService);
    prisma = module.get<PrismaService>(PrismaService);

    // Cria dois usuários de teste para validar controle de acesso
    const role = await prisma.role.findUnique({ where: { name: UserRole.CLIENT } });

    const userA = await prisma.user.create({
      data: {
        name: 'Cliente A',
        email: `cliente.a.${Date.now()}@autowash.local`,
        phone: '11988880001',
        cpfEncrypted: 'mock_encrypted_a',
        cpfLookupHash: `hash_a_${Date.now()}`,
        passwordHash: 'mock_hash',
        status: 'ACTIVE',
        roles: { create: { roleId: role!.id } },
      },
    });
    clientAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        name: 'Cliente B',
        email: `cliente.b.${Date.now()}@autowash.local`,
        phone: '11988880002',
        cpfEncrypted: 'mock_encrypted_b',
        cpfLookupHash: `hash_b_${Date.now()}`,
        passwordHash: 'mock_hash',
        status: 'ACTIVE',
        roles: { create: { roleId: role!.id } },
      },
    });
    clientBId = userB.id;
  });

  afterAll(async () => {
    // Limpeza dos dados de teste
    await prisma.vehicle.deleteMany({
      where: { userId: { in: [clientAId, clientBId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [clientAId, clientBId] } },
    });
    await prisma.$disconnect();
  });

  let vehicleAId: string;

  it('1. Cliente A deve cadastrar veículo com placa Mercosul', async () => {
    const result = await vehiclesService.create(clientAId, {
      plate: 'ABC1D23',
      make: 'Honda',
      model: 'Civic Touring',
      year: 2022,
      color: 'Preto Cristal',
      sizeCategory: VehicleSizeCategory.MEDIUM,
      notes: 'Cuidado ao limpar o teto solar',
    });

    expect(result.success).toBe(true);
    expect(result.vehicle.plate).toBe('ABC1D23');
    expect(result.vehicle.internalCode.startsWith('VH-')).toBe(true);
    expect(result.vehicle.userId).toBe(clientAId);

    vehicleAId = result.vehicle.id;
  });

  it('2. Cliente A deve cadastrar veículo sem placa (com código interno automático)', async () => {
    const result = await vehiclesService.create(clientAId, {
      make: 'Toyota',
      model: 'Corolla Cross',
      year: 2024,
      sizeCategory: VehicleSizeCategory.SUV,
    });

    expect(result.success).toBe(true);
    expect(result.vehicle.plate).toBeNull();
    expect(result.vehicle.internalCode).toBeDefined();
    expect(result.vehicle.sizeCategory).toBe(VehicleSizeCategory.SUV);
  });

  it('3. Cliente A lista apenas seus próprios veículos', async () => {
    const vehicles = await vehiclesService.findMyVehicles(clientAId);
    expect(vehicles.length).toBe(2);
    expect(vehicles.every((v) => v.userId === clientAId)).toBe(true);
  });

  it('4. [Anti-IDOR] Cliente B NÃO PODE visualizar o veículo de Cliente A', async () => {
    await expect(
      vehiclesService.findById(vehicleAId, {
        id: clientBId,
        roles: [UserRole.CLIENT],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('5. [Anti-IDOR] Cliente B NÃO PODE editar o veículo de Cliente A', async () => {
    await expect(
      vehiclesService.update(
        vehicleAId,
        { id: clientBId, roles: [UserRole.CLIENT] },
        { color: 'Vermelho' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('6. [Anti-IDOR] Cliente B NÃO PODE excluir o veículo de Cliente A', async () => {
    await expect(
      vehiclesService.remove(vehicleAId, {
        id: clientBId,
        roles: [UserRole.CLIENT],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('7. Cliente A pode editar seu próprio veículo', async () => {
    const updated = await vehiclesService.update(
      vehicleAId,
      { id: clientAId, roles: [UserRole.CLIENT] },
      { color: 'Cinza Boreal' },
    );

    expect(updated.success).toBe(true);
    expect(updated.vehicle.color).toBe('Cinza Boreal');
  });

  it('8. Administrador tem permissão para visualizar o veículo de qualquer cliente', async () => {
    const vehicle = await vehiclesService.findById(vehicleAId, {
      id: 'admin_id_mock',
      roles: [UserRole.ADMIN],
    });

    expect(vehicle.id).toBe(vehicleAId);
    expect(vehicle.user.name).toBe('Cliente A');
  });
});
