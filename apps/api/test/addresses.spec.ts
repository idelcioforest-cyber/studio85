import { Test, TestingModule } from '@nestjs/testing';
import { AddressesService } from '../src/modules/addresses/addresses.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserRole } from '@autowash/shared';
import { ForbiddenException } from '@nestjs/common';

describe('AddressesService (Integration & Telebusca 1-Click Tests)', () => {
  let addressesService: AddressesService;
  let prisma: PrismaService;

  let clientAId: string;
  let clientBId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AddressesService, PrismaService],
    }).compile();

    addressesService = module.get<AddressesService>(AddressesService);
    prisma = module.get<PrismaService>(PrismaService);

    const role = await prisma.role.findUnique({ where: { name: UserRole.CLIENT } });

    const userA = await prisma.user.create({
      data: {
        name: 'Cliente Endereço A',
        email: `address.a.${Date.now()}@autowash.local`,
        phone: '11988880010',
        cpfEncrypted: 'mock_cpf_a',
        cpfLookupHash: `hash_addr_a_${Date.now()}`,
        passwordHash: 'mock_hash',
        status: 'ACTIVE',
        roles: { create: { roleId: role!.id } },
      },
    });
    clientAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        name: 'Cliente Endereço B',
        email: `address.b.${Date.now()}@autowash.local`,
        phone: '11988880020',
        cpfEncrypted: 'mock_cpf_b',
        cpfLookupHash: `hash_addr_b_${Date.now()}`,
        passwordHash: 'mock_hash',
        status: 'ACTIVE',
        roles: { create: { roleId: role!.id } },
      },
    });
    clientBId = userB.id;
  });

  afterAll(async () => {
    await prisma.address.deleteMany({
      where: { userId: { in: [clientAId, clientBId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [clientAId, clientBId] } },
    });
    await prisma.$disconnect();
  });

  let address1Id: string;
  let address2Id: string;

  it('1. Primeiro endereço cadastrado deve ser marcado automaticamente como padrão', async () => {
    const res = await addressesService.create(clientAId, {
      label: 'Casa',
      street: 'Rua das Flores',
      number: '123',
      neighborhood: 'Jardins',
      city: 'Porto Alegre',
      state: 'RS',
      postalCode: '90000000',
      isDefault: false, // Mesmo passando false, por ser o 1º vira true
    });

    expect(res.success).toBe(true);
    expect(res.address.isDefault).toBe(true);
    expect(res.address.label).toBe('Casa');

    address1Id = res.address.id;
  });

  it('2. Ao cadastrar segundo endereço com isDefault: true, o anterior deixa de ser padrão', async () => {
    const res = await addressesService.create(clientAId, {
      label: 'Trabalho',
      street: 'Av. Ipiranga',
      number: '5000',
      neighborhood: 'Partenon',
      city: 'Porto Alegre',
      state: 'RS',
      postalCode: '91000000',
      isDefault: true,
    });

    expect(res.success).toBe(true);
    expect(res.address.isDefault).toBe(true);
    address2Id = res.address.id;

    // Confere que o endereço 1 não é mais padrão
    const addr1 = await prisma.address.findUnique({ where: { id: address1Id } });
    expect(addr1?.isDefault).toBe(false);
  });

  it('3. [Anti-IDOR] Cliente B NÃO PODE acessar nem excluir o endereço de Cliente A', async () => {
    await expect(
      addressesService.findById(address1Id, {
        id: clientBId,
        roles: [UserRole.CLIENT],
      }),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      addressesService.remove(address1Id, {
        id: clientBId,
        roles: [UserRole.CLIENT],
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
