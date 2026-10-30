import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { encryptSensitiveData } from '../src/common/utils/crypto.util';
import { PagarmeClient, PagarmeCharge, PagarmeOrder } from '../src/modules/pagarme/pagarme.client';
import { PagarmeRecipientService } from '../src/modules/pagarme/pagarme-recipient.service';
import { PagarmePaymentsService } from '../src/modules/pagarme/pagarme-payments.service';
import { PagarmeWebhookService } from '../src/modules/pagarme/pagarme-webhook.service';
import { buildSplit } from '../src/modules/pagarme/split-builder';

/** Pagar.me de mentira: guarda o que foi enviado e responde como a API v5 */
class FakePagarme {
  orders: Record<string, unknown>[] = [];
  remote = new Map<string, PagarmeOrder>();
  cancels: { id: string; amount?: number }[] = [];
  getOrderCalls = 0;
  nextCardStatus: 'paid' | 'failed' = 'paid';

  async createOrder(body: Record<string, unknown>): Promise<PagarmeOrder> {
    this.orders.push(body);
    const n = this.orders.length;
    const payment = (body.payments as Record<string, unknown>[])[0];
    const isPix = payment.payment_method === 'pix';
    const amount = ((body.items as { amount: number }[])[0]).amount;
    const charge: PagarmeCharge = {
      id: `ch_test_${n}`,
      status: isPix ? 'pending' : this.nextCardStatus,
      amount,
      paid_amount: !isPix && this.nextCardStatus === 'paid' ? amount : 0,
      paid_at: !isPix && this.nextCardStatus === 'paid' ? new Date().toISOString() : undefined,
      last_transaction: isPix
        ? { qr_code: `00020126pix-de-teste-${n}`, expires_at: new Date(Date.now() + 1800_000).toISOString() }
        : { card: { brand: 'Visa', last_four_digits: '4242' }, acquirer_message: this.nextCardStatus === 'failed' ? 'Transação recusada' : undefined },
    };
    const order: PagarmeOrder = { id: `or_test_${n}`, status: charge.status, amount, metadata: body.metadata as Record<string, string>, charges: [charge] };
    this.remote.set(order.id, order);
    return order;
  }
  async getOrder(id: string) {
    this.getOrderCalls++;
    return this.remote.get(id)!;
  }
  async getCharge(id: string) {
    for (const o of this.remote.values()) if (o.charges?.[0].id === id) return { ...o.charges[0], order: { id: o.id, metadata: o.metadata } };
    throw new Error('charge não existe');
  }
  async cancelCharge(id: string, amount?: number) {
    this.cancels.push({ id, amount });
    const charge = await this.getCharge(id);
    const canceled = (charge.canceled_amount ?? 0) + (amount ?? charge.amount);
    const updated = { ...charge, canceled_amount: canceled, status: canceled >= charge.amount ? 'canceled' : 'paid' };
    const order = this.remote.get(charge.order!.id)!;
    order.charges = [updated];
    return updated;
  }
  /** Simula o cliente pagando o Pix */
  pay(orderId: string) {
    const order = this.remote.get(orderId)!;
    const charge = order.charges![0];
    order.status = 'paid';
    order.charges = [{ ...charge, status: 'paid', paid_amount: charge.amount, paid_at: new Date().toISOString() }];
  }
}

describe('Pagar.me: split, cobrança, estorno e webhook', () => {
  let prisma: PrismaService;
  let payments: PagarmePaymentsService;
  let webhooks: PagarmeWebhookService;
  const fake = new FakePagarme();
  const created = { appointments: [] as string[], recipient: '' };
  let userId: string;
  const env = { ...process.env };

  const newAppointment = async (code: string) => {
    const a = await prisma.appointment.create({
      data: {
        readableCode: code,
        userId,
        customerName: 'Cliente Teste Pagar.me',
        customerPhone: '51988888888',
        vehicleLabel: 'Honda Civic',
        vehiclePlate: 'TST1A23',
        vehicleSize: 'MEDIUM',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000 + 3_600_000),
        totalPriceCents: 7000,
        priceSnapshotJson: '{}',
        status: 'CONFIRMED',
      },
    });
    created.appointments.push(a.id);
    return a;
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      PAGARME_SECRET_KEY: 'sk_test_fake',
      PAGARME_PUBLIC_KEY: 'pk_test_fake',
      PAGARME_PLATFORM_RECIPIENT_ID: 're_platform_test',
      PAGARME_PLATFORM_FEE_PERCENT: '10',
      PAGARME_SOURCE_TAG: 'studio85',
      PAGARME_WEBHOOK_USER: '',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PagarmeRecipientService, PagarmePaymentsService, PagarmeWebhookService, { provide: PagarmeClient, useValue: fake }],
    }).compile();
    prisma = module.get(PrismaService);
    payments = module.get(PagarmePaymentsService);
    webhooks = module.get(PagarmeWebhookService);

    // Cliente com CPF, celular e e-mail (exigidos para pagar online)
    const user = await prisma.user.create({
      data: {
        name: 'Cliente Teste Pagar.me',
        email: `pagarme.${Date.now()}@studio85.test`,
        phone: '51988888888',
        cpfEncrypted: encryptSensitiveData('52998224725'),
        passwordHash: 'x',
        status: 'ACTIVE',
      },
    });
    userId = user.id;
    const recipient = await prisma.paymentRecipient.create({
      data: {
        type: 'individual', name: 'Lava Jato Teste', email: 'dono@studio85.test', documentEncrypted: encryptSensitiveData('52998224725'),
        documentLast4: '4725', phone: '51988888888', birthOrFoundingDate: '1990-01-01', incomeCents: 500000, professionalOccupation: 'Empresário',
        street: 'R. Amapá', streetNumber: '16', neighborhood: 'Cavalhada', city: 'Porto Alegre', state: 'RS', zipCode: '91740460',
        bankHolderName: 'Lava Jato Teste', bankCode: '260', branchNumber: '0001', accountEncrypted: encryptSensitiveData('12345678'),
        accountLast4: '5678', accountCheckDigit: '9', accountType: 'checking', pagarmeRecipientId: 're_washer_test', status: 'active',
        // O sistema usa o recebedor mais antigo: este passa na frente de qualquer outro do banco de dev
        createdAt: new Date('2000-01-01T00:00:00Z'),
      },
    });
    created.recipient = recipient.id;
  });

  afterAll(async () => {
    const orders = await prisma.order.findMany({ where: { appointmentId: { in: created.appointments } }, select: { id: true } });
    const pays = await prisma.payment.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { id: true } });
    await prisma.financialEntry.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.refund.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { id: { in: pays.map((p) => p.id) } } });
    await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
    await prisma.appointment.deleteMany({ where: { id: { in: created.appointments } } });
    await prisma.paymentRecipient.deleteMany({ where: { id: created.recipient } });
    await prisma.pagarmeWebhookEvent.deleteMany({ where: { eventId: { startsWith: 'hook_test_' } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    process.env = env;
  });

  it('1. Split: lava-jato paga taxas e responde por tudo; plataforma com comissão limpa; soma 100', () => {
    const rules = buildSplit('re_w', 're_p', 10);
    expect(rules.reduce((acc, r) => acc + r.amount, 0)).toBe(100);
    expect(rules[0]).toMatchObject({ recipient_id: 're_w', amount: 90, options: { liable: true, charge_processing_fee: true, charge_remainder_fee: true } });
    expect(rules[1]).toMatchObject({ recipient_id: 're_p', amount: 10, options: { liable: false, charge_processing_fee: false, charge_remainder_fee: false } });
    expect(buildSplit('re_w', 're_p', 0)).toEqual([expect.objectContaining({ recipient_id: 're_w', amount: 100 })]);
    expect(() => buildSplit('re_w', 're_p', 101)).toThrow();
  });

  it('2. Pix: pedido com split, metadata de origem e QR; pedir de novo reaproveita o mesmo Pix', async () => {
    const a = await newAppointment(`TST-PIX-${Date.now() % 100000}`);
    const pix = await payments.createPix(userId, a.id);
    const body = fake.orders.at(-1)! as { metadata: Record<string, string>; payments: { pix: { expires_in: number }; split: unknown[] }[] };
    expect(body.metadata).toMatchObject({ source: 'studio85', appointment_id: a.id, payment_id: pix.id });
    expect(body.payments[0].pix.expires_in).toBe(1800);
    expect(body.payments[0].split).toEqual(buildSplit('re_washer_test', 're_platform_test', 10));
    expect(pix.status).toBe('PENDING');
    expect(pix.pix?.qrCodeImage).toMatch(/^data:image\/png;base64,/);

    const again = await payments.createPix(userId, a.id);
    expect(again.id).toBe(pix.id);
    expect(fake.orders.filter((o) => (o.metadata as Record<string, string>).appointment_id === a.id)).toHaveLength(1);
  });

  it('3. Cartão: só o token chega; aprovado vira pago e entra no caixa', async () => {
    const a = await newAppointment(`TST-CARD-${Date.now() % 100000}`);
    fake.nextCardStatus = 'paid';
    const paid = await payments.createCard(userId, a.id, { cardToken: 'token_abc123', installments: 1 });
    const body = fake.orders.at(-1)! as { payments: { credit_card: Record<string, unknown>; split: unknown[] }[] };
    expect(body.payments[0].credit_card).toEqual({ installments: 1, statement_descriptor: 'STUDIO85', card_token: 'token_abc123' });
    expect(body.payments[0].split).toHaveLength(2);
    expect(paid).toMatchObject({ status: 'PAID', card: { brand: 'Visa', last4: '4242' } });
    const entries = await prisma.financialEntry.findMany({ where: { paymentId: paid.id } });
    expect(entries.map((e) => [e.entryType, e.amountCents])).toEqual([['SALE', 7000]]);
  });

  it('4. Estorno parcial: chama o Pagar.me com o valor e registra a devolução no caixa', async () => {
    const pay = await prisma.payment.findFirstOrThrow({ where: { provider: 'PAGARME', status: 'PAID', order: { appointmentId: { in: created.appointments } } } });
    const result = await payments.refund(pay.id, { amountCents: 2000 }, userId);
    expect(fake.cancels.at(-1)).toEqual({ id: pay.providerTransactionId, amount: 2000 });
    expect(result.payment).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 2000 });
    const refundEntry = await prisma.financialEntry.findFirst({ where: { paymentId: pay.id, entryType: 'REFUND' } });
    expect(refundEntry?.amountCents).toBe(-2000);
  });

  it('5. Webhook: ignora outro sistema com 200, reconsulta a API e não processa duas vezes', async () => {
    const foreign = await webhooks.receive({ id: 'hook_test_foreign', type: 'order.paid', data: { id: 'or_de_outro_sistema', metadata: { source: 'auroraprompts' } } });
    expect(foreign.status).toBe('ignored');
    expect(await prisma.pagarmeWebhookEvent.count({ where: { eventId: 'hook_test_foreign' } })).toBe(0);

    const pending = await prisma.payment.findFirstOrThrow({ where: { provider: 'PAGARME', method: 'PIX', status: 'PENDING', order: { appointmentId: { in: created.appointments } } } });
    fake.pay(pending.externalOrderId!);
    const calls = fake.getOrderCalls;
    // Payload mente ("status: failed"): o sistema confia só na reconsulta à API
    const event = { id: 'hook_test_paid', type: 'order.paid', data: { id: pending.externalOrderId!, status: 'failed', metadata: { source: 'studio85' } } };
    expect((await webhooks.receive(event)).status).toBe('stored');
    const stored = await prisma.pagarmeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'hook_test_paid' } });
    await webhooks.process(stored.id);
    expect(fake.getOrderCalls).toBeGreaterThan(calls);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PAID');
    expect((await webhooks.receive(event)).status).toBe('duplicate');
    expect(await prisma.financialEntry.count({ where: { paymentId: pending.id, entryType: 'SALE' } })).toBe(1);
  });

  it('6. Webhook: Basic Auth só é exigido quando configurado', () => {
    process.env.PAGARME_WEBHOOK_USER = '';
    expect(() => webhooks.assertAuthorized(undefined)).not.toThrow();
    process.env.PAGARME_WEBHOOK_USER = 'pagarme';
    process.env.PAGARME_WEBHOOK_PASS = 'segredo-forte';
    expect(() => webhooks.assertAuthorized(undefined)).toThrow(UnauthorizedException);
    expect(() => webhooks.assertAuthorized(`Basic ${Buffer.from('pagarme:errada').toString('base64')}`)).toThrow(UnauthorizedException);
    expect(() => webhooks.assertAuthorized(`Basic ${Buffer.from('pagarme:segredo-forte').toString('base64')}`)).not.toThrow();
    process.env.PAGARME_WEBHOOK_USER = '';
  });

  it('7. Conferência automática: Pix pago sem webhook entra no caixa; consultado há pouco espera a vez', async () => {
    const a = await newAppointment(`TST-SYNC-${Date.now() % 100000}`);
    const pix = await payments.createPix(userId, a.id);
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: pix.id } });
    fake.pay(pay.externalOrderId!);

    // Acabou de ser consultado: ainda não entra na rodada
    await payments.reconcilePending();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pix.id } })).status).toBe('PENDING');

    await prisma.payment.update({ where: { id: pix.id }, data: { lastSyncedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await payments.reconcilePending();
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: pix.id } });
    expect(after.status).toBe('PAID');
    const entries = await prisma.financialEntry.findMany({ where: { paymentId: pix.id } });
    expect(entries.map((e) => [e.entryType, e.amountCents])).toEqual([['SALE', 7000]]);
  });

  it('8. Modo temporário: sem recebedor do lava-jato, só abre com a opção ligada e tudo fica com a plataforma', async () => {
    await prisma.paymentRecipient.update({ where: { id: created.recipient }, data: { status: 'affiliation' } });
    try {
      process.env.PAGARME_FALLBACK_TO_PLATFORM = '';
      expect((await payments.onlineConfig()).enabled).toBe(false);

      process.env.PAGARME_FALLBACK_TO_PLATFORM = 'true';
      expect((await payments.onlineConfig()).enabled).toBe(true);
      const a = await newAppointment(`TST-PLAT-${Date.now() % 100000}`);
      const pix = await payments.createPix(userId, a.id);
      const body = fake.orders.at(-1)! as { payments: Record<string, unknown>[] };
      expect(body.payments[0]).not.toHaveProperty('split');
      const pay = await prisma.payment.findUniqueOrThrow({ where: { id: pix.id } });
      expect(pay).toMatchObject({ platformFeePercent: 100, platformFeeCents: 7000, recipientCents: 0 });
    } finally {
      process.env.PAGARME_FALLBACK_TO_PLATFORM = '';
      await prisma.paymentRecipient.update({ where: { id: created.recipient }, data: { status: 'active' } });
    }
  });
});
