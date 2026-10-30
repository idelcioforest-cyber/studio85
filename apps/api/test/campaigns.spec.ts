import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { MAX_CAMPAIGN_BATCH, SendCampaignSchema, displayName } from '@autowash/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { WhatsAppBridgeService, WhatsAppSendError } from '../src/modules/whatsapp/whatsapp-bridge.service';
import { NotificationsService } from '../src/modules/whatsapp/notifications.service';
import { CampaignsService } from '../src/modules/whatsapp/campaigns.service';
import { MailService } from '../src/modules/mail/mail.service';

/**
 * Aviso em massa: até 20 contatos por vez, um por minuto, sem repetir quem já recebeu.
 * A ponte do WhatsApp é simulada; o banco é o de desenvolvimento.
 */
describe('Aviso em massa pelo WhatsApp', () => {
  let prisma: PrismaService;
  let campaigns: CampaignsService;
  const tag = Date.now() % 100_000_000;
  // Celulares únicos deste teste (DDD 51 + 9 + 8 dígitos)
  const phone = (n: number) => `519${String(tag + n).padStart(8, '0').slice(-8)}`;
  const ids = { users: [] as string[], appointments: [] as string[], campaign: '' };
  const bridge = {
    enabled: true,
    configured: true,
    normalizePhone: WhatsAppBridgeService.prototype.normalizePhone,
    getStatus: jest.fn(async () => ({ status: 'CONNECTED' })),
    sendText: jest.fn(async (_phone: string, _text: string) => ({ id: 'wamid.teste' })),
  };
  // Começa dois minutos à frente para não esbarrar em envios anteriores do banco de dev
  let clock = Date.now() + 2 * 60_000;
  const tick = (advanceMs = 61_000) => {
    clock += advanceMs;
    return campaigns.tick(new Date(clock));
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        CampaignsService,
        NotificationsService,
        { provide: WhatsAppBridgeService, useValue: bridge },
        { provide: MailService, useValue: {} },
      ],
    }).compile();
    prisma = module.get(PrismaService);
    campaigns = module.get(CampaignsService);

    // A fila é uma só: lotes esquecidos no banco de dev não podem travar o teste
    await prisma.whatsAppCampaignRecipient.updateMany({ where: { status: { in: ['QUEUED', 'SENDING'] } }, data: { status: 'CANCELED' } });

    const role = await prisma.role.findUnique({ where: { name: 'CLIENT' } });
    for (const [n, name] of [[1, 'MARIA DA SILVA'], [2, 'JOSÉ SANTOS']] as const) {
      const user = await prisma.user.create({
        data: { name, phone: phone(n), passwordHash: 'x', status: 'ACTIVE', roles: { create: { roleId: role!.id } } },
      });
      ids.users.push(user.id);
    }
    // Balcão sem conta: um com o mesmo celular da Maria (conta uma vez só), um novo e um com celular inválido
    for (const [code, name, tel] of [
      ['A', 'MARIA BALCAO', phone(1)],
      ['B', 'PEDRO BALCAO', `(${phone(3).slice(0, 2)}) ${phone(3).slice(2)}`],
      ['C', 'SEM CELULAR', '123'],
    ]) {
      const a = await prisma.appointment.create({
        data: {
          readableCode: `AV${code}-${tag}`,
          source: 'WALK_IN',
          customerName: name,
          customerPhone: tel,
          vehicleLabel: 'Honda Fit',
          vehicleSize: 'SMALL',
          startsAt: new Date(Date.now() - 86_400_000),
          endsAt: new Date(Date.now() - 86_400_000 + 3_600_000),
          totalPriceCents: 6000,
          priceSnapshotJson: '{}',
          status: 'DELIVERED',
        },
      });
      ids.appointments.push(a.id);
    }
    const campaign = await campaigns.create({ title: `Promo ${tag}`, body: 'Olá, {primeiro_nome}! Novidade no {empresa}.' });
    ids.campaign = campaign.id;
  });

  afterAll(async () => {
    await prisma.whatsAppCampaign.deleteMany({ where: { id: ids.campaign } });
    await prisma.whatsAppMessage.deleteMany({ where: { templateKey: 'AVISO', phone: { in: [phone(1), phone(2), `55${phone(3)}`, `55${phone(1)}`, `55${phone(2)}`] } } });
    await prisma.appointment.deleteMany({ where: { id: { in: ids.appointments } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  });

  it('1. Contatos: com conta e de balcão, um por número; celular inválido fica de fora', async () => {
    const mine = (await campaigns.contacts()).filter((c) => [phone(1), phone(2), phone(3)].some((p) => c.phone === `55${p}`));
    expect(mine.map((c) => [c.name, c.phone, c.hasAccount])).toEqual([
      ['JOSÉ SANTOS', `55${phone(2)}`, true],
      ['MARIA DA SILVA', `55${phone(1)}`, true],
      ['PEDRO BALCAO', `55${phone(3)}`, false],
    ]);
    // A Maria esteve no balcão ontem: essa é a última visita dela
    expect(mine[1].lastVisit).not.toBeNull();
    expect(displayName('MARIA DA SILVA')).toBe('Maria da Silva');
  });

  it('2. No máximo 20 por vez; enquanto o lote não termina, não entra outro', async () => {
    const tooMany = Array.from({ length: MAX_CAMPAIGN_BATCH + 1 }, (_, i) => `55519${String(i).padStart(8, '0')}`);
    expect(SendCampaignSchema.safeParse({ phones: tooMany }).success).toBe(false);

    const result = await campaigns.send(ids.campaign, { phones: [`55${phone(1)}`, `55${phone(3)}`] });
    expect(result).toEqual({ queued: 2, alreadySent: 0, minutes: 2 });
    await expect(campaigns.send(ids.campaign, { phones: [`55${phone(2)}`] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('3. Fila: uma mensagem por minuto, com o nome do cliente; falha fica registrada', async () => {
    bridge.sendText.mockClear();
    expect(await tick()).toBe('SENT');
    expect(bridge.sendText).toHaveBeenCalledWith(`55${phone(1)}`, 'Olá, Maria! Novidade no Studio 85.');
    // Menos de um minuto depois: espera
    expect(await tick(30_000)).toBeNull();
    bridge.sendText.mockRejectedValueOnce(new WhatsAppSendError('Número sem WhatsApp.', false));
    expect(await tick(31_000)).toBe('FAILED');

    const { contacts, campaign } = await campaigns.detail(ids.campaign);
    const status = (p: string) => contacts.find((c) => c.phone === `55${p}`);
    expect(status(phone(1))).toMatchObject({ status: 'SENT' });
    expect(status(phone(3))).toMatchObject({ status: 'FAILED', error: 'Número sem WhatsApp.' });
    expect(campaign.counts).toMatchObject({ SENT: 1, FAILED: 1, QUEUED: 0 });
    const log = await prisma.whatsAppMessage.findFirst({ where: { templateKey: 'AVISO', phone: `55${phone(1)}` } });
    expect(log).toMatchObject({ status: 'SENT', body: 'Olá, Maria! Novidade no Studio 85.' });
  });

  it('4. Quem já recebeu não recebe de novo; quem falhou pode ir de novo', async () => {
    const result = await campaigns.send(ids.campaign, { phones: [`55${phone(1)}`, `55${phone(3)}`, `55${phone(2)}`] });
    expect(result).toMatchObject({ queued: 2, alreadySent: 1 });
    // Parar o envio: quem estava na fila fica livre para depois
    expect(await campaigns.cancel(ids.campaign)).toEqual({ canceled: 2 });
    expect(await tick()).toBeNull();
  });

  it('5. WhatsApp desconectado: não aceita lote novo e a fila espera o número voltar', async () => {
    bridge.getStatus.mockResolvedValue({ status: 'DISCONNECTED' });
    try {
      await expect(campaigns.send(ids.campaign, { phones: [`55${phone(2)}`] })).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      bridge.getStatus.mockResolvedValue({ status: 'CONNECTED' });
    }
    await campaigns.send(ids.campaign, { phones: [`55${phone(2)}`] });
    bridge.getStatus.mockResolvedValueOnce({ status: 'DISCONNECTED' });
    expect(await tick()).toBeNull();
    expect(await tick()).toBe('SENT');
    expect(bridge.sendText).toHaveBeenLastCalledWith(`55${phone(2)}`, 'Olá, José! Novidade no Studio 85.');
  });
});
