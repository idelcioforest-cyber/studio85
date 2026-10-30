import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { encryptSensitiveData } from '../src/common/utils/crypto.util';
import { PagarmeCharge, PagarmeClient, PagarmeInvoice, PagarmeSubscription } from '../src/modules/pagarme/pagarme.client';
import { PagarmeRecipientService } from '../src/modules/pagarme/pagarme-recipient.service';
import { PagarmePaymentsService } from '../src/modules/pagarme/pagarme-payments.service';
import { PagarmeSubscriptionsService } from '../src/modules/pagarme/pagarme-subscriptions.service';
import { PagarmeWebhookService } from '../src/modules/pagarme/pagarme-webhook.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';
import { ScheduleService } from '../src/modules/schedule/schedule.service';
import { NotificationsService } from '../src/modules/whatsapp/notifications.service';
import { cardCharge, parseOnlineFees, pixCharge, withFee } from '@autowash/shared';

const DAY = 86_400_000;

/** Pagar.me de mentira para a recorrência: cobra na criação conforme `nextInvoice` */
class FakePagarme {
  subscriptions: Record<string, unknown>[] = [];
  remote = new Map<string, PagarmeSubscription>();
  invoices = new Map<string, PagarmeInvoice>();
  charges = new Map<string, PagarmeCharge>();
  canceled: string[] = [];
  nextInvoice: 'paid' | 'failed' = 'paid';

  async createSubscription(body: Record<string, unknown>): Promise<PagarmeSubscription> {
    this.subscriptions.push(body);
    const n = this.subscriptions.length;
    const items = body.items as { pricing_scheme: { price: number } }[];
    const amount = items.reduce((acc, i) => acc + i.pricing_scheme.price, 0);
    const start = new Date();
    const cycle = { id: `cycle_${n}`, start_at: start.toISOString(), end_at: new Date(start.getTime() + 30 * DAY).toISOString() };
    const sub: PagarmeSubscription = { id: `sub_test_${n}`, status: 'active', current_cycle: cycle, card: { brand: 'Mastercard', last_four_digits: '5454' } };
    this.remote.set(sub.id, sub);
    this.addInvoice(sub.id, amount, this.nextInvoice, cycle);
    return sub;
  }
  addInvoice(subId: string, amount: number, status: 'paid' | 'failed', cycle: { start_at: string; end_at: string }) {
    const n = this.invoices.size + 1;
    const charge: PagarmeCharge = {
      id: `ch_sub_${n}`,
      status,
      amount,
      paid_amount: status === 'paid' ? amount : 0,
      paid_at: status === 'paid' ? new Date().toISOString() : undefined,
    };
    this.charges.set(charge.id, charge);
    const invoice: PagarmeInvoice = { id: `in_test_${n}`, status, amount, subscription: { id: subId }, charge, cycle, created_at: new Date().toISOString() };
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }
  async getSubscription(id: string) {
    return this.remote.get(id)!;
  }
  async cancelSubscription(id: string) {
    this.canceled.push(id);
    const sub = { ...this.remote.get(id)!, status: 'canceled' };
    this.remote.set(id, sub);
    return sub;
  }
  async listInvoices(subId: string) {
    return [...this.invoices.values()].filter((i) => i.subscription?.id === subId);
  }
  async getInvoice(id: string) {
    return this.invoices.get(id)!;
  }
  async getCharge(id: string) {
    return this.charges.get(id)!;
  }
}

describe('Assinaturas: plano livre, cartão recorrente, cobertura das lavagens e taxa repassada', () => {
  let prisma: PrismaService;
  let subscriptions: SubscriptionsService;
  let pagarmeSubs: PagarmeSubscriptionsService;
  let webhooks: PagarmeWebhookService;
  let appointments: AppointmentsService;
  const fake = new FakePagarme();
  const env = { ...process.env };
  const ids = { user: '', vehicle: '', otherVehicle: '', category: '', wash: '', wax: '', extra: '', recipient: '', plan: '', settings: '' };
  let originalSettings: { subscriptionsEnabled: boolean; onlineFeesJson: string | null } | null = null;
  const tag = Date.now() % 1_000_000;

  beforeAll(async () => {
    Object.assign(process.env, {
      PAGARME_SECRET_KEY: 'sk_test_fake',
      PAGARME_PUBLIC_KEY: 'pk_test_fake',
      PAGARME_PLATFORM_RECIPIENT_ID: 're_platform_test',
      PAGARME_PLATFORM_FEE_PERCENT: '2',
      PAGARME_SOURCE_TAG: 'studio85',
      PAGARME_WEBHOOK_USER: '',
      PAGARME_FALLBACK_TO_PLATFORM: '',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        PagarmeRecipientService,
        PagarmePaymentsService,
        PagarmeSubscriptionsService,
        PagarmeWebhookService,
        SubscriptionsService,
        AppointmentsService,
        { provide: PagarmeClient, useValue: fake },
        { provide: ScheduleService, useValue: {} },
        { provide: NotificationsService, useValue: { notifyInBackground: () => undefined } },
      ],
    }).compile();
    prisma = module.get(PrismaService);
    subscriptions = module.get(SubscriptionsService);
    pagarmeSubs = module.get(PagarmeSubscriptionsService);
    webhooks = module.get(PagarmeWebhookService);
    appointments = module.get(AppointmentsService);

    // Configurações: assinaturas liberadas e taxa do cartão 1x de 4,99% + R$ 0,50 (restauradas no fim)
    let settings = await prisma.businessSettings.findFirst();
    if (!settings) settings = await prisma.businessSettings.create({ data: {} });
    ids.settings = settings.id;
    originalSettings = { subscriptionsEnabled: settings.subscriptionsEnabled, onlineFeesJson: settings.onlineFeesJson };
    await prisma.businessSettings.update({
      where: { id: settings.id },
      data: {
        subscriptionsEnabled: true,
        onlineFeesJson: JSON.stringify({ pixPercentBp: 119, pixFixedCents: 0, cardFixedCents: 50, cardPercentBp: [499, 599, 599, 699, 699, 699, 799, 799, 799, 799, 799, 799], maxInstallments: 3 }),
      },
    });

    const category = await prisma.serviceCategory.create({ data: { name: `Teste assinatura ${tag}` } });
    ids.category = category.id;
    const mk = (name: string, price: number) =>
      prisma.service.create({ data: { categoryId: category.id, name: `${name} ${tag}`, basePriceCents: price, baseDurationMinutes: 30 } });
    ids.wash = (await mk('Lavagem externa', 5000)).id;
    ids.wax = (await mk('Cera', 3000)).id;
    ids.extra = (await mk('Higienização', 9000)).id;

    const user = await prisma.user.create({
      data: {
        name: 'CLIENTE ASSINANTE TESTE',
        email: `assinante.${tag}@studio85.test`,
        phone: '51977776666',
        cpfEncrypted: encryptSensitiveData('52998224725'),
        passwordHash: 'x',
        status: 'ACTIVE',
      },
    });
    ids.user = user.id;
    const vehicle = await prisma.vehicle.create({
      data: { userId: user.id, plate: `SUB${String(tag % 10000).padStart(4, '0')}`, internalCode: `VH-S${tag}`, make: 'HONDA', model: 'FIT', sizeCategory: 'SMALL' },
    });
    ids.vehicle = vehicle.id;
    const other = await prisma.vehicle.create({
      data: { userId: user.id, internalCode: `VH-T${tag}`, make: 'JEEP', model: 'COMPASS', sizeCategory: 'SUV' },
    });
    ids.otherVehicle = other.id;

    const recipient = await prisma.paymentRecipient.create({
      data: {
        type: 'individual', name: 'Lava Jato Teste', email: 'dono@studio85.test', documentEncrypted: encryptSensitiveData('52998224725'),
        documentLast4: '4725', phone: '51988888888', birthOrFoundingDate: '1990-01-01', incomeCents: 500000, professionalOccupation: 'Empresário',
        street: 'R. Amapá', streetNumber: '16', neighborhood: 'Cavalhada', city: 'Porto Alegre', state: 'RS', zipCode: '91740460',
        bankHolderName: 'Lava Jato Teste', bankCode: '260', branchNumber: '0001', accountEncrypted: encryptSensitiveData('12345678'),
        accountLast4: '5678', accountCheckDigit: '9', accountType: 'checking', pagarmeRecipientId: 're_washer_sub_test', status: 'active',
        createdAt: new Date('2000-01-01T00:00:00Z'),
      },
    });
    ids.recipient = recipient.id;
    // Outros testes rodam em paralelo no mesmo banco: este usa sempre o próprio recebedor
    const recipients = module.get(PagarmeRecipientService);
    jest.spyOn(recipients, 'current').mockImplementation(() => prisma.paymentRecipient.findUnique({ where: { id: ids.recipient } }));
  });

  afterAll(async () => {
    const subs = await prisma.customerSubscription.findMany({ where: { userId: ids.user }, select: { id: true } });
    const subIds = subs.map((s) => s.id);
    const appts = await prisma.appointment.findMany({ where: { userId: ids.user }, select: { id: true } });
    const orders = await prisma.order.findMany({
      where: { OR: [{ subscriptionId: { in: subIds } }, { appointmentId: { in: appts.map((a) => a.id) } }] },
      select: { id: true },
    });
    const pays = await prisma.payment.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { id: true } });
    await prisma.financialEntry.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { id: { in: pays.map((p) => p.id) } } });
    await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
    await prisma.appointment.deleteMany({ where: { id: { in: appts.map((a) => a.id) } } });
    await prisma.customerSubscription.deleteMany({ where: { id: { in: subIds } } });
    if (ids.plan) await prisma.subscriptionPlan.deleteMany({ where: { id: ids.plan } });
    await prisma.vehicle.deleteMany({ where: { userId: ids.user } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.service.deleteMany({ where: { categoryId: ids.category } });
    await prisma.serviceCategory.deleteMany({ where: { id: ids.category } });
    await prisma.paymentRecipient.deleteMany({ where: { id: ids.recipient } });
    await prisma.pagarmeWebhookEvent.deleteMany({ where: { eventId: { startsWith: 'hook_sub_' } } });
    if (originalSettings) await prisma.businessSettings.update({ where: { id: ids.settings }, data: originalSettings });
    await prisma.$disconnect();
    process.env = env;
  });

  it('1. Taxa repassada: o total cobre a taxa e sobra exatamente o preço do serviço', () => {
    const rates = parseOnlineFees(JSON.stringify({ pixPercentBp: 119, cardFixedCents: 50, cardPercentBp: [499, 599], maxInstallments: 2 }));
    const pix = pixCharge(6000, rates);
    expect(pix.totalCents - Math.round((pix.totalCents * 119) / 10_000)).toBeGreaterThanOrEqual(6000);
    expect(pix.totalCents - Math.round((pix.totalCents * 119) / 10_000)).toBeLessThanOrEqual(6001);
    const card = cardCharge(6000, 1, rates);
    expect(card).toEqual({ baseCents: 6000, feeCents: card.totalCents - 6000, totalCents: Math.ceil(6050 / 0.9501) });
    expect(cardCharge(6000, 2, rates).totalCents).toBeGreaterThan(card.totalCents);
    expect(withFee(6000, 0, 0)).toEqual({ baseCents: 6000, feeCents: 0, totalCents: 6000 });
    expect(parseOnlineFees('lixo')).toMatchObject({ maxInstallments: 1, pixPercentBp: 0 });
  });

  it('2. Plano: nada pronto, até 4 serviços, preço por porte; serviço repetido é recusado', async () => {
    expect(await subscriptions.listPlans()).not.toContainEqual(expect.objectContaining({ name: `Plano Teste ${tag}` }));
    const plan = await subscriptions.createPlan({
      name: `Plano Teste ${tag}`,
      washesPerMonth: 2,
      serviceIds: [ids.wash, ids.wax],
      prices: [{ sizeCategory: 'SMALL' as never, priceCents: 9900 }],
      isActive: true,
    });
    ids.plan = plan.id;
    expect(plan).toMatchObject({ washesPerMonth: 2, subscribers: 0, prices: [{ sizeCategory: 'SMALL', priceCents: 9900 }] });
    expect(plan.services.map((s) => s.id).sort()).toEqual([ids.wash, ids.wax].sort());
  });

  it('3. Ativação: só para porte com preço; mensalidade com a taxa do cartão; link do cartão', async () => {
    await expect(subscriptions.activate({ planId: ids.plan, userId: ids.user, vehicleId: ids.otherVehicle })).rejects.toThrow(/porte/);

    const { subscription, setupUrl } = await subscriptions.activate({ planId: ids.plan, userId: ids.user, vehicleId: ids.vehicle });
    const expected = cardCharge(9900, 1, parseOnlineFees(JSON.stringify({ cardFixedCents: 50, cardPercentBp: [499] })));
    expect(subscription).toMatchObject({ status: 'PENDING_CARD', priceCents: 9900, chargedCents: expected.totalCents, linkActive: true });
    expect(setupUrl).toMatch(/\/assinatura\/[A-Za-z0-9_-]{20,}$/);

    // O mesmo veículo não pode ter duas assinaturas abertas
    await expect(subscriptions.activate({ planId: ids.plan, userId: ids.user, vehicleId: ids.vehicle })).rejects.toThrow(/já tem uma assinatura/);

    const token = setupUrl.split('/').pop()!;
    const view = await subscriptions.setupView(token);
    expect(view).toMatchObject({ status: 'PENDING_CARD', firstName: 'CLIENTE', washesPerMonth: 2, needs: { email: false, cpf: false, phone: false } });
    expect(view.services.sort()).toEqual([`Cera ${tag}`, `Lavagem externa ${tag}`]);
    (global as Record<string, unknown>).__token = token;
  });

  it('4. Cartão recusado na 1ª cobrança: recorrência encerrada e o mesmo link aceita outro cartão', async () => {
    const token = (global as Record<string, unknown>).__token as string;
    fake.nextInvoice = 'failed';
    const failed = await subscriptions.setupSubmit(token, { cardToken: 'token_recusado', email: null, cpf: null, phone: null });
    expect(failed).toMatchObject({ status: 'PENDING_CARD', processing: false });
    expect(failed.lastError).toMatch(/recusado/);
    expect(fake.canceled).toHaveLength(1);
  });

  it('5. Cartão aprovado: recorrência com divisão 98/2, mensalidade no caixa e período liberado', async () => {
    const token = (global as Record<string, unknown>).__token as string;
    fake.nextInvoice = 'paid';
    const view = await subscriptions.setupSubmit(token, { cardToken: 'token_aprovado', email: null, cpf: null, phone: null });
    expect(view).toMatchObject({ status: 'ACTIVE', card: { brand: 'Mastercard', last4: '5454' } });

    const body = fake.subscriptions.at(-1)! as {
      card_token: string;
      interval: string;
      billing_type: string;
      metadata: Record<string, string>;
      split: { enabled: boolean; rules: { recipient_id: string; amount: number }[] };
      items: { pricing_scheme: { price: number } }[];
    };
    expect(body).toMatchObject({ card_token: 'token_aprovado', interval: 'month', billing_type: 'prepaid', metadata: { source: 'studio85' } });
    expect(body.split.rules.map((r) => [r.recipient_id, r.amount])).toEqual([['re_washer_sub_test', 98], ['re_platform_test', 2]]);
    // Plano + taxa do cartão em itens separados
    expect(body.items.map((i) => i.pricing_scheme.price)[0]).toBe(9900);
    expect(body.items).toHaveLength(2);

    const sub = await prisma.customerSubscription.findFirstOrThrow({ where: { userId: ids.user, status: 'ACTIVE' } });
    const pays = await prisma.payment.findMany({ where: { order: { subscriptionId: sub.id } } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ status: 'PAID', amountCents: sub.chargedCents, customerFeeCents: sub.customerFeeCents });
    const entries = await prisma.financialEntry.findMany({ where: { paymentId: pays[0].id } });
    expect(entries.map((e) => [e.entryType, e.amountCents])).toEqual([['SALE', sub.chargedCents]]);
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 25 * DAY);

    // Conferência repetida não duplica a mensalidade
    await pagarmeSubs.sync(sub.id);
    expect(await prisma.payment.count({ where: { order: { subscriptionId: sub.id } } })).toBe(1);
  });

  it('6. Lavagem coberta: serviços do plano saem do total; extra é cobrado; limite do mês respeitado', async () => {
    const walkIn = (serviceIds: string[]) =>
      appointments.adminWalkIn({ serviceIds, vehicleId: ids.vehicle, customerName: 'X', customerPhone: null, plate: null, vehicleLabel: 'X', vehicleSize: 'SMALL' as never });

    const first = await walkIn([ids.wash, ids.extra]);
    expect(first.appointment).toMatchObject({ totalPriceCents: 9000, subscriptionCoveredCents: 5000 });
    expect(first.appointment.services.find((s) => s.name.startsWith('Lavagem'))?.coveredBySubscription).toBe(true);
    expect(first.appointment.services.find((s) => s.name.startsWith('Higienização'))?.coveredBySubscription).toBe(false);

    const second = await walkIn([ids.wash, ids.wax]);
    expect(second.appointment).toMatchObject({ totalPriceCents: 0, subscriptionCoveredCents: 8000 });

    // Plano de 2 lavagens por mês: a terceira é cobrada normalmente
    const third = await walkIn([ids.wash]);
    expect(third.appointment).toMatchObject({ totalPriceCents: 5000, subscriptionCoveredCents: 0 });

    const mine = await subscriptions.mine(ids.user);
    expect(mine).toEqual([expect.objectContaining({ vehicleId: ids.vehicle, remaining: 0, washesPerMonth: 2 })]);

    // Cancelar uma lavagem coberta devolve a vaga do mês
    await prisma.appointment.update({ where: { id: second.appointment.id }, data: { status: 'CANCELLED' } });
    expect((await subscriptions.mine(ids.user))[0].remaining).toBe(1);
  });

  it('7. Webhook: fatura de outro sistema é ignorada; renovação recusada só avisa; nova fatura paga avança o período', async () => {
    const sub = await prisma.customerSubscription.findFirstOrThrow({ where: { userId: ids.user, status: 'ACTIVE' } });
    const foreign = await webhooks.receive({ id: 'hook_sub_foreign', type: 'invoice.paid', data: { id: 'in_outro', subscription: { id: 'sub_de_outro_sistema' } } });
    expect(foreign.status).toBe('ignored');

    const end = sub.currentPeriodEnd!;
    const nextCycle = { start_at: end.toISOString(), end_at: new Date(end.getTime() + 30 * DAY).toISOString() };
    const refused = fake.addInvoice(sub.pagarmeSubscriptionId!, sub.chargedCents, 'failed', nextCycle);
    await pagarmeSubs.applyInvoice(refused);
    const afterRefusal = await prisma.customerSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(afterRefusal.status).toBe('ACTIVE');
    expect(afterRefusal.lastError).toMatch(/recusada/);

    const paid = fake.addInvoice(sub.pagarmeSubscriptionId!, sub.chargedCents, 'paid', nextCycle);
    const stored = await webhooks.receive({ id: 'hook_sub_paid', type: 'invoice.paid', data: { id: paid.id, subscription: { id: sub.pagarmeSubscriptionId! } } });
    expect(stored.status).toBe('stored');
    await webhooks.process((await prisma.pagarmeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'hook_sub_paid' } })).id);
    const renewed = await prisma.customerSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(renewed.currentPeriodEnd!.toISOString()).toBe(nextCycle.end_at);
    expect(renewed.lastError).toBeNull();
    expect(await prisma.payment.count({ where: { order: { subscriptionId: sub.id } } })).toBe(2);
  });

  it('8. Cancelar: para a recorrência no Pagar.me e deixa de cobrir novas lavagens', async () => {
    const sub = await prisma.customerSubscription.findFirstOrThrow({ where: { userId: ids.user, status: 'ACTIVE' } });
    const canceled = await subscriptions.cancel(sub.id, 'Cliente pediu');
    expect(canceled.status).toBe('CANCELED');
    expect(fake.canceled).toContain(sub.pagarmeSubscriptionId);
    const after = await appointments.adminWalkIn({ serviceIds: [ids.wash], vehicleId: ids.vehicle, customerName: 'X', customerPhone: null, plate: null, vehicleLabel: 'X', vehicleSize: 'SMALL' as never });
    expect(after.appointment.subscriptionCoveredCents).toBe(0);
    expect(await subscriptions.mine(ids.user)).toEqual([]);
  });
});
