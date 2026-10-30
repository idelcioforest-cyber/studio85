import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { AppointmentStatus, Prisma, VehicleSizeCategory as DbVehicleSize } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService, NON_BLOCKING_STATUSES } from '../schedule/schedule.service';
import { NotificationsService } from '../whatsapp/notifications.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { resolveSelectionPricing } from '../services/pricing.util';
import {
  CreateAppointmentInput,
  WalkInAppointmentInput,
  PayAppointmentInput,
  AdminCreateAppointmentInput,
  UpdateAppointmentStatusInput,
  cleanPlate,
} from '@autowash/shared';
import { zonedTimeToUtc, toZonedDateString, addDays } from '../../common/utils/timezone.util';
import {
  MAX_RECEIPT_BYTES,
  MAX_PHOTO_BYTES,
  detectReceiptType,
  detectImageType,
  saveStoredFile,
  deleteStoredFile,
  resolveStoragePath,
} from '../../common/utils/private-storage.util';
import { hashPassword } from '../../common/utils/crypto.util';

// Arquivo recebido pelo upload multipart (armazenado em memória até a validação)
export interface UploadedFileData {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
}

type Db = PrismaService | Prisma.TransactionClient;
type PaymentMethod = PayAppointmentInput['method'];

const formatCents = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const APPOINTMENT_INCLUDE = {
  // Serviço principal (mais longo) primeiro
  services: { orderBy: { durationMinutes: 'desc' } },
  // Parcialmente estornado continua pago (pelo valor líquido)
  order: { include: { payments: { where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } }, orderBy: { paidAt: 'desc' } } } },
  user: { select: { email: true, mustChangePassword: true } },
  mediaAssets: {
    where: { visibility: 'CLIENT_VISIBLE' },
    select: { id: true, category: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.AppointmentInclude;

type AppointmentWithServices = Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_INCLUDE }>;

const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'];

// Transições permitidas no fluxo operacional do pátio
const STATUS_FLOW: Record<AppointmentStatus, AppointmentStatus[]> = {
  DRAFT: [],
  PENDING_PAYMENT: [],
  CONFIRMED: ['CHECK_IN', 'CANCELLED', 'NO_SHOW'],
  CHECK_IN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['READY'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const ACTIVE_STATUSES: AppointmentStatus[] = ['CHECK_IN', 'IN_PROGRESS', 'READY'];
// Agendados dos dias seguintes mostrados no Pátio
const UPCOMING_LIMIT = 100;

/**
 * Formato público do agendamento: só o snapshot, sem IDs internos de usuário ou dados sensíveis
 */
function toDto(a: AppointmentWithServices) {
  const paid = a.order?.payments[0];
  return {
    id: a.id,
    code: a.readableCode,
    status: a.status,
    source: a.source,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    totalPriceCents: a.totalPriceCents,
    telebuscaFeeCents: a.telebuscaFeeCents,
    // Valor dos serviços cobertos pela assinatura (já fora do total)
    subscriptionCoveredCents: a.subscriptionCoveredCents,
    isTelebusca: a.isTelebusca,
    customerName: a.customerName,
    customerPhone: a.customerPhone,
    vehiclePlate: a.vehiclePlate,
    vehicleLabel: a.vehicleLabel,
    vehicleSize: a.vehicleSize,
    notes: a.clientNotes,
    cancelledAt: a.cancelledAt,
    // Só a equipe vê o motivo (removido na lista do cliente)
    cancellationReason: a.cancellationReason,
    services: a.services.map((s) => ({
      name: s.serviceNameSnapshot,
      priceCents: s.unitPriceCents,
      durationMinutes: s.durationMinutes,
      coveredBySubscription: s.coveredBySubscription,
    })),
    payment: paid
      ? {
          status: 'PAID' as const,
          method: paid.method,
          // ON_DELIVERY = recebido na loja; PAGARME = pago online pelo app
          provider: paid.provider,
          amountCents: paid.amountCents,
          refundedCents: paid.refundedCents,
          // Diferença em relação ao total: positivo = desconto, negativo = acréscimo
          adjustmentCents: a.totalPriceCents - paid.amountCents,
          adjustmentReason: a.order?.adjustmentReason ?? null,
          paidAt: paid.paidAt,
          hasReceipt: Boolean(paid.receiptStorageKey),
        }
      : { status: 'PENDING' as const },
    // Conta do cliente: NONE = cadastro rápido sem login, PENDING = senha provisória, ACTIVE = usa o app
    customer: a.userId
      ? {
          id: a.userId,
          appAccess: !a.user?.email ? ('NONE' as const) : a.user.mustChangePassword ? ('PENDING' as const) : ('ACTIVE' as const),
        }
      : null,
    photos: a.mediaAssets.map((m) => ({ id: m.id, category: m.category })),
    createdAt: a.createdAt,
  };
}

const STAFF_ROLES = ['ADMIN', 'MANAGER', 'ATTENDANT', 'WASHER'];
const MAX_PHOTOS_PER_APPOINTMENT = 30;

// Sem caracteres ambíguos (0/O, 1/l/I) para ditar ou digitar sem erro
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generateTemporaryPassword(length = 10): string {
  return Array.from({ length }, () => TEMP_PASSWORD_ALPHABET[crypto.randomInt(TEMP_PASSWORD_ALPHABET.length)]).join('');
}

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private schedule: ScheduleService,
    private notifications: NotificationsService,
    private subscriptions: SubscriptionsService,
  ) {}

  /**
   * Agendamento pelo app: exige cliente autenticado com veículo na própria garagem (Anti-IDOR)
   */
  async create(userId: string, input: CreateAppointmentInput) {
    const [user, vehicle, services, settings] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } }),
      this.prisma.vehicle.findFirst({ where: { id: input.vehicleId, userId, status: 'ACTIVE' } }),
      this.loadServices(input.serviceIds),
      this.prisma.businessSettings.findFirst(),
    ]);

    if (!user) throw new NotFoundException('Conta não encontrada.');
    if (!vehicle) throw new NotFoundException('Veículo não encontrado na sua garagem.');

    const pricing = this.priceSelection(services, vehicle.sizeCategory);

    let pickupAddress: Prisma.AddressGetPayload<object> | null = null;
    let telebuscaFeeCents = 0;
    if (input.telebusca) {
      if (!settings?.telebuscaEnabled) {
        throw new BadRequestException('A Telebusca não está disponível no momento.');
      }
      if (!input.pickupAddressId) {
        throw new BadRequestException('Selecione o endereço de coleta.');
      }
      pickupAddress = await this.prisma.address.findFirst({
        where: { id: input.pickupAddressId, userId },
      });
      if (!pickupAddress) throw new NotFoundException('Endereço não encontrado.');
      telebuscaFeeCents = settings.telebuscaFeeCents;
    }

    const vehicleLabel = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(' ');

    const appointment = await this.prisma.$transaction(
      async (tx) => {
        const { startsAt, endsAt } = await this.schedule.reserveSlot(
          tx,
          input.date,
          input.time,
          pricing.durationMinutes,
        );

        const vehicleBusy = await tx.appointment.count({
          where: {
            vehicleId: vehicle.id,
            status: { notIn: NON_BLOCKING_STATUSES },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
        });
        if (vehicleBusy > 0) {
          throw new BadRequestException('Este veículo já tem um agendamento neste horário.');
        }

        const plan = await this.subscriptionPricing(tx, pricing, { userId, vehicleId: vehicle.id, startsAt });
        return tx.appointment.create({
          data: {
            readableCode: await this.generateCode(tx),
            userId,
            vehicleId: vehicle.id,
            source: 'APP',
            customerName: user.name,
            customerPhone: user.phone,
            vehiclePlate: vehicle.plate,
            vehicleLabel,
            vehicleSize: vehicle.sizeCategory,
            startsAt,
            endsAt,
            status: 'CONFIRMED',
            totalPriceCents: pricing.priceCents - plan.coveredCents + telebuscaFeeCents,
            telebuscaFeeCents,
            subscriptionId: plan.subscriptionId,
            subscriptionCoveredCents: plan.coveredCents,
            isTelebusca: Boolean(pickupAddress),
            pickupAddressId: pickupAddress?.id ?? null,
            pickupAddressSnapshot: pickupAddress
              ? JSON.stringify({
                  street: pickupAddress.street,
                  number: pickupAddress.number,
                  complement: pickupAddress.complement,
                  neighborhood: pickupAddress.neighborhood,
                  city: pickupAddress.city,
                  state: pickupAddress.state,
                  postalCode: pickupAddress.postalCode,
                  referencePoint: pickupAddress.referencePoint,
                })
              : null,
            telebuscaStatus: pickupAddress ? 'PENDING' : null,
            priceSnapshotJson: this.priceSnapshot(pricing, vehicle.sizeCategory, telebuscaFeeCents, plan.coveredCents),
            clientNotes: input.notes || null,
            services: { create: this.serviceItems(pricing, plan.covered) },
          },
          include: APPOINTMENT_INCLUDE,
        });
      },
      // Read Committed + lock da grade do dia: a contagem de vagas sempre enxerga reservas já confirmadas
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 },
    );

    this.notifications.notifyInBackground(appointment.id, 'APPOINTMENT_CONFIRMED');

    return {
      success: true,
      message: 'Agendamento confirmado.',
      appointment: toDto(appointment),
    };
  }

  /**
   * Agendamentos do próprio cliente (Anti-IDOR: filtra pelo usuário autenticado)
   */
  async findMine(userId: string) {
    const list = await this.prisma.appointment.findMany({
      where: { userId },
      include: APPOINTMENT_INCLUDE,
      orderBy: { startsAt: 'desc' },
      take: 100,
    });
    // O motivo do ajuste é anotação interna do caixa: não aparece no app do cliente
    return list.map(toDto).map((a) => ({
      ...a,
      cancellationReason: null,
      payment: a.payment.status === 'PAID' ? { ...a.payment, adjustmentReason: null } : a.payment,
    }));
  }

  async cancelMine(userId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, userId },
      include: { order: { include: { payments: { where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } } } } },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado.');
    if (appointment.order?.payments.length) {
      throw new BadRequestException('Este agendamento já foi pago. Fale com a gente pelo WhatsApp para cancelar e receber o estorno.');
    }

    if (appointment.status !== 'CONFIRMED') {
      throw new BadRequestException(
        'Este agendamento não pode mais ser cancelado pelo app. Fale com a gente pelo WhatsApp.',
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: 'Cancelado pelo cliente',
      },
      include: APPOINTMENT_INCLUDE,
    });

    return {
      success: true,
      message: 'Agendamento cancelado. O horário voltou a ficar disponível.',
      appointment: toDto(updated),
    };
  }

  /**
   * Pátio: agendamentos do dia + veículos ainda em atendimento de dias anteriores
   */
  async adminList(date?: string) {
    const timeZone = await this.schedule.getTimezone();
    const day = date || toZonedDateString(new Date(), timeZone);
    const dayStart = zonedTimeToUtc(day, '00:00', timeZone);
    const dayEnd = zonedTimeToUtc(addDays(day, 1), '00:00', timeZone);

    const upcomingWhere: Prisma.AppointmentWhereInput = { status: 'CONFIRMED', startsAt: { gte: dayEnd } };
    const [list, upcoming, upcomingTotal] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          OR: [
            { startsAt: { gte: dayStart, lt: dayEnd } },
            { status: { in: ACTIVE_STATUSES } },
          ],
        },
        include: APPOINTMENT_INCLUDE,
        orderBy: { startsAt: 'asc' },
      }),
      // O que vem pela frente depois do dia escolhido, para a equipe se programar
      this.prisma.appointment.findMany({ where: upcomingWhere, include: APPOINTMENT_INCLUDE, orderBy: { startsAt: 'asc' }, take: UPCOMING_LIMIT }),
      this.prisma.appointment.count({ where: upcomingWhere }),
    ]);

    return { date: day, appointments: list.map(toDto), upcoming: upcoming.map(toDto), upcomingTotal };
  }

  async adminUpdateStatus(id: string, input: UpdateAppointmentStatusInput) {
    const { status } = input;
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: { order: { include: { payments: { where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } } } } },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado.');

    if (!STATUS_FLOW[appointment.status].includes(status)) {
      throw new BadRequestException('Esta mudança de etapa não é permitida para o agendamento.');
    }
    if (status === 'CANCELLED' && appointment.order?.payments.length) {
      throw new BadRequestException(
        appointment.order.payments.some((p) => p.provider === 'PAGARME')
          ? 'Este atendimento foi pago online. Estorne o pagamento em Pagamentos antes de desmarcar.'
          : 'Este atendimento já foi pago. Desfaça o recebimento no Caixa antes de desmarcar.',
      );
    }

    // Desmarcar libera a vaga na hora (cancelados não ocupam a agenda)
    const reason = input.reason?.trim();
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        status,
        ...(status === 'CANCELLED'
          ? { cancelledAt: new Date(), cancellationReason: `Desmarcado pela equipe${reason ? `: ${reason}` : ''}`.slice(0, 255) }
          : {}),
      },
      include: APPOINTMENT_INCLUDE,
    });

    // Carro pronto: avisa o cliente no WhatsApp (com as fotos de depois, se configurado)
    if (status === 'READY') this.notifications.notifyInBackground(id, 'CAR_READY');
    if (status === 'CANCELLED' && input.notifyClient) this.notifications.notifyInBackground(id, 'APPOINTMENT_CANCELLED');

    return {
      success: true,
      message: status === 'CANCELLED' ? 'Agendamento desmarcado. O horário ficou livre na agenda.' : undefined,
      appointment: toDto(updated),
    };
  }

  /**
   * Entrada de cliente de balcão: o carro já está no pátio, então entra direto em CHECK_IN
   */
  async adminWalkIn(input: WalkInAppointmentInput) {
    const services = await this.loadServices(input.serviceIds);

    // Cliente já cadastrado escolhido na busca: vincula à conta e usa os dados do cadastro
    let userId: string | null = null;
    let vehicleId: string | null = null;
    let customerName = input.customerName;
    let customerPhone = input.customerPhone || null;
    let vehiclePlate = input.plate || null;
    let vehicleLabel = input.vehicleLabel;
    let vehicleSize = input.vehicleSize;

    if (input.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: input.vehicleId, status: 'ACTIVE' },
        include: { user: { select: { id: true, name: true, phone: true } } },
      });
      if (!vehicle) throw new NotFoundException('Veículo não encontrado.');
      userId = vehicle.userId;
      vehicleId = vehicle.id;
      customerName = vehicle.user.name;
      customerPhone = vehicle.user.phone;
      vehiclePlate = vehicle.plate;
      vehicleLabel = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(' ');
      vehicleSize = vehicle.sizeCategory as typeof vehicleSize;
    } else if (input.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, name: true, phone: true },
      });
      if (!user) throw new NotFoundException('Cliente não encontrado.');
      userId = user.id;
      customerName = user.name;
      customerPhone = user.phone;
    }

    const pricing = this.priceSelection(services, vehicleSize);

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + pricing.durationMinutes * 60000);

    const created = await this.prisma.$transaction(async (tx) => {
      const plan = await this.subscriptionPricing(tx, pricing, { userId, vehicleId, startsAt });
      return tx.appointment.create({
        data: {
          readableCode: await this.generateCode(tx),
          source: 'WALK_IN',
          userId,
          vehicleId,
          customerName,
          customerPhone,
          vehiclePlate,
          vehicleLabel,
          vehicleSize,
          startsAt,
          endsAt,
          status: 'CHECK_IN',
          totalPriceCents: pricing.priceCents - plan.coveredCents,
          subscriptionId: plan.subscriptionId,
          subscriptionCoveredCents: plan.coveredCents,
          priceSnapshotJson: this.priceSnapshot(pricing, vehicleSize, 0, plan.coveredCents),
          clientNotes: input.notes || null,
          services: { create: this.serviceItems(pricing, plan.covered) },
        },
        include: APPOINTMENT_INCLUDE,
      });
      // Read Committed: depois da trava da assinatura, a contagem do mês enxerga reservas recém-confirmadas
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return { success: true, message: 'Entrada registrada.', appointment: toDto(created) };
  }

  /**
   * Busca de clientes para a entrada de balcão: contas cadastradas (por nome, e-mail, telefone ou placa)
   * e clientes de balcão já atendidos. Nunca retorna CPF.
   */
  async adminSearchCustomers(q: string) {
    const term = q.trim();
    const digits = term.replace(/\D/g, '');
    const plate = cleanPlate(term);

    const userFilters: Prisma.UserWhereInput[] = [{ name: { contains: term } }, { email: { contains: term } }];
    if (digits.length >= 3) userFilters.push({ phone: { contains: digits } });
    if (plate.length >= 3) userFilters.push({ vehicles: { some: { plate: { contains: plate }, status: 'ACTIVE' } } });

    const clients = await this.prisma.user.findMany({
      where: {
        roles: { some: { role: { name: 'CLIENT' } } },
        status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] },
        OR: userFilters,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        vehicles: {
          where: { status: 'ACTIVE' },
          select: { id: true, plate: true, make: true, model: true, color: true, sizeCategory: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
      take: 8,
    });

    const walkInFilters: Prisma.AppointmentWhereInput[] = [{ customerName: { contains: term } }];
    if (digits.length >= 3) walkInFilters.push({ customerPhone: { contains: digits } });
    if (plate.length >= 3) walkInFilters.push({ vehiclePlate: { contains: plate } });

    const pastWalkIns = await this.prisma.appointment.findMany({
      where: { source: 'WALK_IN', userId: null, OR: walkInFilters },
      select: { customerName: true, customerPhone: true, vehiclePlate: true, vehicleLabel: true, vehicleSize: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    // Um item por cliente + veículo (o atendimento mais recente)
    const seen = new Set<string>();
    const walkIns = pastWalkIns
      .filter((w) => {
        const key = `${w.customerName.toLowerCase()}|${w.vehiclePlate ?? w.vehicleLabel.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);

    return { clients, walkIns };
  }

  /**
   * Recebimento na retirada: registra pedido, pagamento e lançamento no caixa.
   * O valor cobrado pode diferir do total (desconto ou acréscimo na hora); a diferença fica no pedido.
   * Trava a linha do agendamento para que dois caixas não recebam o mesmo carro.
   */
  async adminPay(id: string, input: PayAppointmentInput) {
    const { method } = input;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id} FOR UPDATE`;
        const appointment = await tx.appointment.findUnique({
          where: { id },
          include: { order: { include: { payments: true } } },
        });
        if (!appointment) throw new NotFoundException('Agendamento não encontrado.');
        if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') {
          throw new BadRequestException('Agendamento cancelado não pode ser recebido.');
        }
        if (appointment.order?.payments.some((p) => p.status === 'PAID')) {
          throw new ConflictException('Este atendimento já foi pago.');
        }

        const chargedCents = input.amountCents ?? appointment.totalPriceCents;
        const adjustmentCents = appointment.totalPriceCents - chargedCents;
        const adjustmentReason = adjustmentCents !== 0 ? input.adjustmentReason || null : null;
        const orderData = {
          subtotalCents: appointment.totalPriceCents - appointment.telebuscaFeeCents,
          telebuscaFeeCents: appointment.telebuscaFeeCents,
          discountCents: adjustmentCents,
          adjustmentReason,
          totalCents: chargedCents,
          status: 'PAID' as const,
        };
        const order = appointment.order
          ? await tx.order.update({ where: { id: appointment.order.id }, data: orderData })
          : await tx.order.create({ data: { ...orderData, appointmentId: appointment.id, userId: appointment.userId } });

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            provider: 'ON_DELIVERY',
            method,
            amountCents: chargedCents,
            status: 'PAID',
            paidAt: new Date(),
          },
        });
        const adjustmentNote =
          adjustmentCents === 0
            ? ''
            : ` · ${adjustmentCents > 0 ? 'desconto' : 'acréscimo'} de ${formatCents(Math.abs(adjustmentCents))}${
                adjustmentReason ? ` (${adjustmentReason})` : ''
              }`;
        await tx.financialEntry.create({
          data: {
            paymentId: payment.id,
            entryType: 'SALE',
            amountCents: payment.amountCents,
            description: `${appointment.readableCode} · ${appointment.vehiclePlate ?? appointment.vehicleLabel}${adjustmentNote}`.slice(0, 255),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const updated = await this.prisma.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
    return { success: true, message: 'Pagamento registrado.', appointment: toDto(updated) };
  }

  /**
   * Desfaz um recebimento lançado por engano (somente no mesmo dia). A ação fica na trilha de auditoria.
   */
  async adminUnpay(id: string) {
    const timeZone = await this.schedule.getTimezone();
    const today = toZonedDateString(new Date(), timeZone);

    const removedReceipt = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id} FOR UPDATE`;
        const appointment = await tx.appointment.findUnique({
          where: { id },
          include: { order: { include: { payments: true } } },
        });
        if (!appointment) throw new NotFoundException('Agendamento não encontrado.');

        const payment = appointment.order?.payments.find((p) => p.status === 'PAID' && p.provider === 'ON_DELIVERY');
        if (!payment || !appointment.order) {
          throw new BadRequestException('Este atendimento não tem recebimento registrado.');
        }
        if (!payment.paidAt || toZonedDateString(payment.paidAt, timeZone) !== today) {
          throw new BadRequestException('Só é possível desfazer recebimentos feitos hoje.');
        }

        await tx.financialEntry.deleteMany({ where: { paymentId: payment.id } });
        await tx.payment.delete({ where: { id: payment.id } });
        // Volta ao valor cheio: um novo recebimento pode ter outro ajuste
        await tx.order.update({
          where: { id: appointment.order.id },
          data: { status: 'PENDING', discountCents: 0, adjustmentReason: null, totalCents: appointment.totalPriceCents },
        });
        return payment.receiptStorageKey;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    await deleteStoredFile(removedReceipt);

    const updated = await this.prisma.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
    return { success: true, message: 'Recebimento desfeito.', appointment: toDto(updated) };
  }

  /**
   * Anexa (ou substitui) o comprovante de um pagamento já registrado. Tipo validado pelos bytes do arquivo.
   */
  async adminAttachReceipt(id: string, file?: UploadedFileData) {
    if (!file?.buffer?.length) throw new BadRequestException('Selecione o arquivo do comprovante.');
    if (file.size > MAX_RECEIPT_BYTES) throw new BadRequestException('Arquivo muito grande. Envie até 5 MB.');

    const type = detectReceiptType(file.buffer);
    if (!type) throw new BadRequestException('Formato não aceito. Envie uma foto (JPG, PNG ou WEBP) ou um PDF.');

    const payment = await this.findPaidPayment(id);
    const storageKey = await saveStoredFile('receipts', file.buffer, type.ext);
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        receiptStorageKey: storageKey,
        receiptMimeType: type.mime,
        receiptSizeBytes: file.size,
        receiptUploadedAt: new Date(),
      },
    });
    await deleteStoredFile(payment.receiptStorageKey);

    const updated = await this.prisma.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
    return { success: true, message: 'Comprovante anexado.', appointment: toDto(updated) };
  }

  async adminRemoveReceipt(id: string) {
    const payment = await this.findPaidPayment(id);
    if (!payment.receiptStorageKey) throw new BadRequestException('Este pagamento não tem comprovante.');

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { receiptStorageKey: null, receiptMimeType: null, receiptSizeBytes: null, receiptUploadedAt: null },
    });
    await deleteStoredFile(payment.receiptStorageKey);

    const updated = await this.prisma.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
    return { success: true, message: 'Comprovante removido.', appointment: toDto(updated) };
  }

  /**
   * Arquivo do comprovante para exibição à equipe (nunca exposto por URL pública)
   */
  async adminGetReceipt(id: string) {
    const payment = await this.findPaidPayment(id);
    if (!payment.receiptStorageKey || !payment.receiptMimeType) {
      throw new NotFoundException('Este pagamento não tem comprovante.');
    }
    const appointment = await this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      select: { readableCode: true },
    });
    const ext = payment.receiptStorageKey.split('.').pop();
    return {
      path: resolveStoragePath(payment.receiptStorageKey),
      mimeType: payment.receiptMimeType,
      fileName: `comprovante-${appointment.readableCode}.${ext}`,
    };
  }

  /**
   * Agendamento lançado pela equipe (ex.: pedido no WhatsApp). Cliente novo vira cadastro rápido
   * (nome + veículo, sem login). Pode usar a tolerância de vagas e qualquer horário do turno.
   */
  async adminCreate(input: AdminCreateAppointmentInput) {
    const services = await this.loadServices(input.serviceIds);

    let vehicle: { id: string; userId: string; plate: string | null; make: string; model: string; color: string | null; sizeCategory: DbVehicleSize; user: { id: string; name: string; phone: string | null } } | null = null;
    let existingUser: { id: string; name: string; phone: string | null } | null = null;

    if (input.vehicleId) {
      vehicle = await this.prisma.vehicle.findFirst({
        where: { id: input.vehicleId, status: 'ACTIVE' },
        include: { user: { select: { id: true, name: true, phone: true } } },
      });
      if (!vehicle) throw new NotFoundException('Veículo não encontrado.');
    } else if (input.userId) {
      existingUser = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, name: true, phone: true },
      });
      if (!existingUser) throw new NotFoundException('Cliente não encontrado.');
    }

    if (!vehicle && input.plate) {
      const plateOwner = await this.prisma.vehicle.findFirst({
        where: { plate: input.plate, status: 'ACTIVE' },
        include: { user: { select: { name: true } } },
      });
      if (plateOwner) {
        throw new ConflictException(
          `A placa ${input.plate} já está cadastrada para ${plateOwner.user.name}. Selecione o cliente na busca.`,
        );
      }
    }

    const size = (vehicle?.sizeCategory ?? input.vehicleSize) as DbVehicleSize;
    const pricing = this.priceSelection(services, size);
    const clientRole = await this.prisma.role.findUnique({ where: { name: 'CLIENT' } });
    // Cadastro rápido nasce sem senha utilizável: o acesso ao app é liberado depois pela equipe
    const unusablePasswordHash = vehicle || existingUser ? null : await hashPassword(crypto.randomBytes(32).toString('hex'));

    const appointment = await this.prisma.$transaction(
      async (tx) => {
        const { startsAt, endsAt } = await this.schedule.reserveSlot(
          tx,
          input.date,
          input.time,
          pricing.durationMinutes,
          { staff: true },
        );

        const customer =
          vehicle?.user ??
          existingUser ??
          (await tx.user.create({
            data: {
              name: input.customerName!,
              phone: input.customerPhone || null,
              passwordHash: unusablePasswordHash!,
              status: 'ACTIVE',
              profileIncomplete: true,
              ...(clientRole ? { roles: { create: { roleId: clientRole.id } } } : {}),
            },
            select: { id: true, name: true, phone: true },
          }));

        const car =
          vehicle ??
          (await tx.vehicle.create({
            data: {
              userId: customer.id,
              plate: input.plate || null,
              internalCode: `VH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
              make: '',
              model: input.vehicleLabel!,
              sizeCategory: size,
            },
          }));

        const vehicleBusy = await tx.appointment.count({
          where: {
            vehicleId: car.id,
            status: { notIn: NON_BLOCKING_STATUSES },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
        });
        if (vehicleBusy > 0) {
          throw new BadRequestException('Este veículo já tem um agendamento neste horário.');
        }

        const plan = await this.subscriptionPricing(tx, pricing, { userId: customer.id, vehicleId: car.id, startsAt });
        return tx.appointment.create({
          data: {
            readableCode: await this.generateCode(tx),
            userId: customer.id,
            vehicleId: car.id,
            source: 'WHATSAPP',
            customerName: customer.name,
            customerPhone: customer.phone,
            vehiclePlate: car.plate,
            vehicleLabel: [car.make, car.model, car.color].filter(Boolean).join(' '),
            vehicleSize: car.sizeCategory,
            startsAt,
            endsAt,
            status: 'CONFIRMED',
            totalPriceCents: pricing.priceCents - plan.coveredCents,
            subscriptionId: plan.subscriptionId,
            subscriptionCoveredCents: plan.coveredCents,
            priceSnapshotJson: this.priceSnapshot(pricing, car.sizeCategory, 0, plan.coveredCents),
            clientNotes: input.notes || null,
            services: { create: this.serviceItems(pricing, plan.covered) },
          },
          include: APPOINTMENT_INCLUDE,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 },
    );

    this.notifications.notifyInBackground(appointment.id, 'APPOINTMENT_CONFIRMED');
    return { success: true, message: 'Agendamento registrado.', appointment: toDto(appointment) };
  }

  /**
   * Libera o app para um cliente cadastrado pela equipe: associa o e-mail e gera uma senha provisória
   * (exibida uma única vez). No primeiro login o cliente troca a senha e completa os dados.
   */
  async adminGrantAccess(userId: string, email: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.roles.some((r) => r.role.name === 'CLIENT')) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    if (user.email && !user.mustChangePassword && !user.profileIncomplete) {
      throw new BadRequestException('Este cliente já usa o app com a própria senha.');
    }

    const emailOwner = await this.prisma.user.findFirst({ where: { email, NOT: { id: userId } }, select: { id: true } });
    if (emailOwner) throw new ConflictException('Este e-mail já está em uso por outra conta.');

    const temporaryPassword = generateTemporaryPassword();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    return {
      success: true,
      message: 'Acesso liberado. Envie o e-mail e a senha provisória ao cliente.',
      customerName: user.name,
      email,
      temporaryPassword,
    };
  }

  // --- Fotos de antes e depois ---

  async adminAddPhoto(appointmentId: string, category: 'BEFORE' | 'AFTER', file: UploadedFileData | undefined, staffId: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Selecione a foto.');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('Foto muito grande. Envie até 8 MB.');
    const type = detectImageType(file.buffer);
    if (!type) throw new BadRequestException('Formato não aceito. Envie uma foto JPG, PNG ou WEBP.');

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, _count: { select: { mediaAssets: true } } },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado.');
    if (appointment._count.mediaAssets >= MAX_PHOTOS_PER_APPOINTMENT) {
      throw new BadRequestException(`Limite de ${MAX_PHOTOS_PER_APPOINTMENT} fotos por atendimento.`);
    }

    const storageKey = await saveStoredFile('photos', file.buffer, type.ext);
    const photo = await this.prisma.mediaAsset.create({
      data: {
        appointmentId,
        category,
        storageKey,
        mimeType: type.mime,
        fileSizeBytes: file.size,
        uploadedById: staffId,
      },
      select: { id: true, category: true, createdAt: true },
    });
    return { success: true, photo };
  }

  async adminDeletePhoto(photoId: string) {
    const photo = await this.prisma.mediaAsset.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Foto não encontrada.');
    await this.prisma.mediaAsset.delete({ where: { id: photoId } });
    await deleteStoredFile(photo.storageKey);
    return { success: true, message: 'Foto removida.' };
  }

  /**
   * Foto para exibição: equipe vê todas; cliente só as visíveis do próprio atendimento (Anti-IDOR)
   */
  async getPhotoFile(photoId: string, user: { id: string; roles: string[] }) {
    const photo = await this.prisma.mediaAsset.findUnique({
      where: { id: photoId },
      include: { appointment: { select: { userId: true } } },
    });
    const isStaff = user.roles.some((r) => STAFF_ROLES.includes(r));
    const isOwner = photo?.appointment?.userId === user.id && photo?.visibility === 'CLIENT_VISIBLE';
    if (!photo || (!isStaff && !isOwner)) throw new NotFoundException('Foto não encontrada.');

    return { path: resolveStoragePath(photo.storageKey), mimeType: photo.mimeType };
  }

  private async findPaidPayment(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { order: { include: { payments: { where: { status: 'PAID' }, orderBy: { paidAt: 'desc' } } } } },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado.');
    const payment = appointment.order?.payments[0];
    if (!payment) throw new BadRequestException('Registre o pagamento antes de anexar o comprovante.');
    return payment;
  }

  /**
   * Caixa do dia: recebimentos por forma de pagamento e atendimentos ainda a receber
   */
  async adminCash(date?: string) {
    const timeZone = await this.schedule.getTimezone();
    const day = date || toZonedDateString(new Date(), timeZone);
    const dayStart = zonedTimeToUtc(day, '00:00', timeZone);
    const dayEnd = zonedTimeToUtc(addDays(day, 1), '00:00', timeZone);

    const payments = await this.prisma.payment.findMany({
      where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] }, paidAt: { gte: dayStart, lt: dayEnd } },
      include: { order: { include: { appointment: { include: APPOINTMENT_INCLUDE } } } },
      orderBy: { paidAt: 'desc' },
    });

    const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;
    let discountCents = 0;
    const received = payments.flatMap((p) => {
      if (!p.order.appointment) return [];
      // Online estornado em parte entra pelo valor líquido
      if (p.method in byMethod) byMethod[p.method as PaymentMethod] += p.amountCents - p.refundedCents;
      discountCents += Math.max(0, p.order.appointment.totalPriceCents - p.amountCents);
      return [{ appointment: toDto(p.order.appointment) }];
    });

    const candidates = await this.prisma.appointment.findMany({
      where: {
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        OR: [{ startsAt: { gte: dayStart, lt: dayEnd } }, { status: { in: ACTIVE_STATUSES } }],
      },
      include: APPOINTMENT_INCLUDE,
      orderBy: { startsAt: 'asc' },
    });
    // Totalmente coberto pela assinatura não tem nada a receber
    const pending = candidates.map(toDto).filter((a) => a.payment.status === 'PENDING' && a.totalPriceCents > 0);

    return {
      date: day,
      totals: {
        receivedCents: Object.values(byMethod).reduce((acc, v) => acc + v, 0),
        pendingCents: pending.reduce((acc, a) => acc + a.totalPriceCents, 0),
        discountCents,
        byMethod,
      },
      received: received.map((r) => r.appointment),
      pending,
    };
  }

  /**
   * Serviços ativos escolhidos, na ordem em que o cliente marcou
   */
  private async loadServices(serviceIds: string[]) {
    const services = await this.prisma.service.findMany({
      where: { id: { in: serviceIds }, isActive: true },
      include: { priceRules: true },
    });
    if (services.length !== serviceIds.length) {
      throw new NotFoundException('Um dos serviços escolhidos não está mais disponível.');
    }
    return serviceIds.map((id) => services.find((s) => s.id === id)!);
  }

  private priceSelection(services: Awaited<ReturnType<AppointmentsService['loadServices']>>, size: string) {
    const selection = resolveSelectionPricing(services, size as Parameters<typeof resolveSelectionPricing>[1]);
    if (selection.unavailable.length > 0) {
      throw new BadRequestException(
        `${selection.unavailable.join(', ')} não está disponível para o porte do veículo.`,
      );
    }
    return selection;
  }

  /**
   * Assinatura do veículo com o período pago cobrindo a data e lavagens sobrando no mês:
   * os serviços do plano saem do total. Roda dentro da transação (a assinatura fica travada).
   */
  private async subscriptionPricing(
    tx: Prisma.TransactionClient,
    pricing: ReturnType<AppointmentsService['priceSelection']>,
    args: { userId: string | null; vehicleId: string | null; startsAt: Date },
  ) {
    const coverage = await this.subscriptions.coverage(tx, { ...args, serviceIds: pricing.items.map((i) => i.service.id) });
    const covered = coverage?.covered ?? new Set<string>();
    return {
      subscriptionId: coverage?.subscriptionId ?? null,
      covered,
      coveredCents: pricing.items.filter((i) => covered.has(i.service.id)).reduce((acc, i) => acc + i.priceCents, 0),
    };
  }

  private priceSnapshot(
    pricing: ReturnType<AppointmentsService['priceSelection']>,
    sizeCategory: string,
    telebuscaFeeCents: number,
    subscriptionCoveredCents = 0,
  ) {
    return JSON.stringify({
      sizeCategory,
      items: pricing.items.map((i) => ({
        serviceId: i.service.id,
        serviceName: i.service.name,
        priceCents: i.priceCents,
        durationMinutes: i.durationMinutes,
      })),
      servicesPriceCents: pricing.priceCents,
      durationMinutes: pricing.durationMinutes,
      telebuscaFeeCents,
      subscriptionCoveredCents,
    });
  }

  private serviceItems(pricing: ReturnType<AppointmentsService['priceSelection']>, covered = new Set<string>()) {
    return pricing.items.map((i) => ({
      serviceId: i.service.id,
      serviceNameSnapshot: i.service.name,
      unitPriceCents: i.priceCents,
      durationMinutes: i.durationMinutes,
      coveredBySubscription: covered.has(i.service.id),
    }));
  }

  private async generateCode(db: Db): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `S85-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const exists = await db.appointment.findUnique({ where: { readableCode: code }, select: { id: true } });
      if (!exists) return code;
    }
    throw new Error('Falha ao gerar código do agendamento');
  }
}
