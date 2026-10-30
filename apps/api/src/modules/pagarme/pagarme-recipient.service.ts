import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PaymentRecipient } from '@prisma/client';
import { PaymentRecipientInput } from '@autowash/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptSensitiveData, encryptSensitiveData } from '../../common/utils/crypto.util';
import { PagarmeClient, PagarmeError, PagarmeRecipient } from './pagarme.client';
import { pagarmeConfig } from './pagarme.config';

export interface StoredPartner {
  name: string;
  email: string;
  cpf: string;
  birthdate: string;
  incomeCents: number;
  occupation: string;
}

const STATUS_LABELS: Record<string, string> = {
  registration: 'Em cadastro',
  affiliation: 'Em análise',
  active: 'Liberado',
  refused: 'Recusado',
  suspended: 'Suspenso',
  blocked: 'Bloqueado',
  inactive: 'Inativo',
};

const toBrDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const mask = (last4: string) => `•••${last4}`;

/**
 * Recebedor do lava-jato no Pagar.me: cadastro (PF/PJ + conta bancária), link de verificação
 * de identidade (KYC) e status. O checkout online só abre com o recebedor "active".
 */
@Injectable()
export class PagarmeRecipientService {
  private readonly logger = new Logger(PagarmeRecipientService.name);

  constructor(
    private prisma: PrismaService,
    private client: PagarmeClient,
  ) {}

  current() {
    return this.prisma.paymentRecipient.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  async isActive(): Promise<boolean> {
    if (!pagarmeConfig.configured) return false;
    const recipient = await this.current();
    return recipient?.status === 'active' && Boolean(recipient.pagarmeRecipientId);
  }

  feePercentFor(recipient: PaymentRecipient | null): number {
    return recipient?.feePercent ?? pagarmeConfig.platformFeePercent;
  }

  async adminView() {
    const recipient = await this.current();
    return {
      configured: pagarmeConfig.configured,
      platformFeePercent: this.feePercentFor(recipient),
      recipient: recipient ? this.toDto(recipient) : null,
    };
  }

  /**
   * Salva o cadastro. Na primeira vez também cria o recebedor no Pagar.me e o link de verificação.
   * Depois de criado, o Pagar.me só aceita trocar a conta bancária; os dados cadastrais ficam como estão.
   */
  async save(input: PaymentRecipientInput) {
    const existing = await this.current();
    if (existing?.pagarmeRecipientId && existing.documentEncrypted && decryptSensitiveData(existing.documentEncrypted) !== input.document) {
      throw new BadRequestException('O CPF/CNPJ do recebedor já enviado ao Pagar.me não pode ser trocado por aqui.');
    }

    const data = {
      type: input.type,
      name: input.name,
      tradingName: input.type === 'corporation' ? input.tradingName ?? null : null,
      email: input.email,
      documentEncrypted: encryptSensitiveData(input.document),
      documentLast4: input.document.slice(-4),
      phone: input.phone,
      birthOrFoundingDate: input.birthOrFoundingDate,
      incomeCents: input.incomeCents,
      professionalOccupation: input.professionalOccupation ?? null,
      street: input.street,
      streetNumber: input.streetNumber,
      complement: input.complement || null,
      neighborhood: input.neighborhood,
      city: input.city,
      state: input.state,
      zipCode: input.zipCode,
      partnerEncrypted: input.type === 'corporation' && input.partner ? encryptSensitiveData(JSON.stringify(input.partner)) : null,
      bankHolderName: input.bankHolderName,
      bankCode: input.bankCode,
      branchNumber: input.branchNumber,
      branchCheckDigit: input.branchCheckDigit || null,
      accountEncrypted: encryptSensitiveData(input.accountNumber),
      accountLast4: input.accountNumber.slice(-4),
      accountCheckDigit: input.accountCheckDigit,
      accountType: input.accountType,
      feePercent: input.feePercent ?? null,
    };
    const saved = existing
      ? await this.prisma.paymentRecipient.update({ where: { id: existing.id }, data })
      : await this.prisma.paymentRecipient.create({ data });

    if (!pagarmeConfig.configured) {
      return {
        ...(await this.adminView()),
        message: 'Dados salvos. Falta configurar as chaves do Pagar.me no servidor para enviar o cadastro.',
      };
    }

    try {
      if (!saved.pagarmeRecipientId) {
        const remote = await this.client.createRecipient(this.recipientPayload(saved, input));
        await this.prisma.paymentRecipient.update({
          where: { id: saved.id },
          data: { pagarmeRecipientId: remote.id, status: remote.status, kycStatus: remote.kyc_details?.status ?? null, lastError: null },
        });
        await this.generateKyc().catch((error) => this.logger.warn(`Link de verificação não gerado: ${(error as Error).message}`));
        return { ...(await this.adminView()), message: 'Recebedor criado no Pagar.me. Agora faça a verificação de identidade.' };
      }

      await this.client.updateRecipientBankAccount(saved.pagarmeRecipientId, this.bankAccountPayload(saved, input.accountNumber, input.document));
      await this.prisma.paymentRecipient.update({ where: { id: saved.id }, data: { lastError: null } });
      return {
        ...(await this.adminView()),
        message: 'Conta bancária e comissão atualizadas. Os dados cadastrais já enviados ao Pagar.me continuam os mesmos.',
      };
    } catch (error) {
      const message = error instanceof PagarmeError ? error.message : 'Falha ao falar com o Pagar.me.';
      await this.prisma.paymentRecipient.update({ where: { id: saved.id }, data: { lastError: message.slice(0, 2000) } });
      throw new BadRequestException(`Dados salvos, mas o Pagar.me recusou: ${message}`);
    }
  }

  async generateKyc() {
    const recipient = await this.requireRemote();
    const link = await this.client.createKycLink(recipient.pagarmeRecipientId!);
    await this.prisma.paymentRecipient.update({
      where: { id: recipient.id },
      data: {
        kycUrl: link.url,
        kycQrCode: link.base64_qrcode ?? null,
        kycExpiresAt: link.expires_at ? new Date(link.expires_at) : null,
      },
    });
    return this.adminView();
  }

  async refreshStatus() {
    const recipient = await this.requireRemote();
    await this.applyRemote(await this.client.getRecipient(recipient.pagarmeRecipientId!));
    return this.adminView();
  }

  /** Atualiza status a partir do recebedor reconsultado na API (botão e webhook recipient.*) */
  async applyRemote(remote: PagarmeRecipient) {
    await this.prisma.paymentRecipient.updateMany({
      where: { pagarmeRecipientId: remote.id },
      data: { status: remote.status, kycStatus: remote.kyc_details?.status ?? null },
    });
  }

  private async requireRemote() {
    if (!pagarmeConfig.configured) throw new ServiceUnavailableException('Configure as chaves do Pagar.me no servidor.');
    const recipient = await this.current();
    if (!recipient?.pagarmeRecipientId) throw new BadRequestException('Cadastre o recebedor primeiro.');
    return recipient;
  }

  private toDto(r: PaymentRecipient) {
    let partner: Omit<StoredPartner, 'cpf'> & { cpfMasked: string } | null = null;
    if (r.partnerEncrypted) {
      const p = JSON.parse(decryptSensitiveData(r.partnerEncrypted)) as StoredPartner;
      partner = { name: p.name, email: p.email, birthdate: p.birthdate, incomeCents: p.incomeCents, occupation: p.occupation, cpfMasked: mask(p.cpf.slice(-4)) };
    }
    const kycExpired = r.kycExpiresAt ? r.kycExpiresAt.getTime() < Date.now() : true;
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      tradingName: r.tradingName,
      email: r.email,
      documentMasked: mask(r.documentLast4),
      phone: r.phone,
      birthOrFoundingDate: r.birthOrFoundingDate,
      incomeCents: r.incomeCents,
      professionalOccupation: r.professionalOccupation,
      street: r.street,
      streetNumber: r.streetNumber,
      complement: r.complement,
      neighborhood: r.neighborhood,
      city: r.city,
      state: r.state,
      zipCode: r.zipCode,
      partner,
      bankHolderName: r.bankHolderName,
      bankCode: r.bankCode,
      branchNumber: r.branchNumber,
      branchCheckDigit: r.branchCheckDigit,
      accountMasked: mask(r.accountLast4),
      accountCheckDigit: r.accountCheckDigit,
      accountType: r.accountType,
      feePercent: r.feePercent,
      pagarmeRecipientId: r.pagarmeRecipientId,
      status: r.status,
      statusLabel: r.status ? STATUS_LABELS[r.status] ?? r.status : 'Não enviado',
      kycStatus: r.kycStatus,
      kyc: r.kycUrl && !kycExpired ? { url: r.kycUrl, qrCode: r.kycQrCode, expiresAt: r.kycExpiresAt } : null,
      kycExpired: Boolean(r.kycUrl) && kycExpired,
      lastError: r.lastError,
    };
  }

  private phonePayload(phone: string) {
    return { ddd: phone.slice(0, 2), number: phone.slice(2), type: 'mobile' };
  }

  private addressPayload(r: PaymentRecipient) {
    return {
      street: r.street,
      complementary: r.complement || 'Sem complemento',
      street_number: r.streetNumber,
      neighborhood: r.neighborhood,
      city: r.city,
      state: r.state,
      zip_code: r.zipCode,
      reference_point: 'Não informado',
    };
  }

  private bankAccountPayload(r: PaymentRecipient, accountNumber: string, document: string) {
    return {
      holder_name: r.bankHolderName,
      holder_type: r.type === 'corporation' ? 'company' : 'individual',
      holder_document: document,
      bank: r.bankCode,
      branch_number: r.branchNumber,
      ...(r.branchCheckDigit ? { branch_check_digit: r.branchCheckDigit } : {}),
      account_number: accountNumber,
      account_check_digit: r.accountCheckDigit,
      type: r.accountType,
    };
  }

  private recipientPayload(r: PaymentRecipient, input: PaymentRecipientInput) {
    const phone = this.phonePayload(r.phone);
    const address = this.addressPayload(r);
    const registerInformation =
      r.type === 'individual'
        ? {
            type: 'individual',
            name: r.name,
            email: r.email,
            document: input.document,
            birthdate: toBrDate(r.birthOrFoundingDate),
            monthly_income: r.incomeCents,
            professional_occupation: r.professionalOccupation,
            phone_numbers: [phone],
            address,
          }
        : {
            type: 'corporation',
            // Na API, company_name é o nome fantasia e trading_name a razão social
            company_name: r.tradingName,
            trading_name: r.name,
            email: r.email,
            document: input.document,
            annual_revenue: r.incomeCents,
            founding_date: r.birthOrFoundingDate,
            main_address: address,
            phone_numbers: [phone],
            managing_partners: input.partner
              ? [
                  {
                    type: 'individual',
                    name: input.partner.name,
                    email: input.partner.email,
                    document: input.partner.cpf,
                    birthdate: toBrDate(input.partner.birthdate),
                    monthly_income: input.partner.incomeCents,
                    professional_occupation: input.partner.occupation,
                    self_declared_legal_representative: true,
                    address,
                    phone_numbers: [phone],
                  },
                ]
              : [],
          };

    return {
      code: r.id,
      register_information: registerInformation,
      default_bank_account: this.bankAccountPayload(r, input.accountNumber, input.document),
      transfer_settings: { transfer_enabled: true, transfer_interval: 'Daily', transfer_day: 0 },
      automatic_anticipation_settings: { enabled: false },
      metadata: { source: pagarmeConfig.sourceTag },
    };
  }
}
