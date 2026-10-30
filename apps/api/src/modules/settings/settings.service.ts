import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateBusinessSettingsInput } from '@autowash/shared';
import { pagarmeConfig } from '../pagarme/pagarme.config';

/** Taxas do cartão (da plataforma, pagas pelo cliente) e até quantas parcelas o dono pode liberar */
function cardInstallments(maxInstallments: number) {
  const rates = pagarmeConfig.feeRates;
  return {
    installmentsAvailable: rates.maxInstallments,
    onlineFees: { ...rates, maxInstallments: Math.min(maxInstallments, rates.maxInstallments) },
  };
}

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Configurações públicas da empresa para o portal do cliente
   */
  async getPublicSettings() {
    const settings = await this.prisma.businessSettings.findFirst();
    if (!settings) {
      return {
        companyName: 'Studio 85',
        telebuscaEnabled: false,
        telebuscaFeeCents: 0,
        cancellationLimitHours: 4,
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
      };
    }

    return {
      companyName: settings.companyName,
      tradeName: settings.tradeName,
      phone: settings.phone,
      email: settings.email,
      address: settings.address,
      telebuscaEnabled: settings.telebuscaEnabled,
      telebuscaFeeCents: settings.telebuscaFeeCents,
      cancellationLimitHours: settings.cancellationLimitHours,
      timezone: settings.timezone,
      currency: settings.currency,
    };
  }

  /**
   * Configurações completas para o painel administrativo
   */
  async getAdminSettings() {
    let settings = await this.prisma.businessSettings.findFirst();
    if (!settings) {
      settings = await this.prisma.businessSettings.create({
        data: {
          companyName: 'Studio 85',
          telebuscaEnabled: false,
          cancellationLimitHours: 4,
        },
      });
    }
    return { ...settings, ...cardInstallments(settings.maxInstallments) };
  }

  /**
   * Atualização das configurações pelo Administrador
   */
  async updateSettings(input: UpdateBusinessSettingsInput) {
    const current = await this.getAdminSettings();
    if (input.maxInstallments !== undefined && input.maxInstallments > current.installmentsAvailable) {
      throw new BadRequestException(`O cartão pode ser parcelado em até ${current.installmentsAvailable}x por enquanto.`);
    }

    const updated = await this.prisma.businessSettings.update({
      where: { id: current.id },
      data: {
        ...(input.companyName !== undefined ? { companyName: input.companyName } : {}),
        ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.telebuscaEnabled !== undefined ? { telebuscaEnabled: input.telebuscaEnabled } : {}),
        ...(input.telebuscaFeeCents !== undefined ? { telebuscaFeeCents: input.telebuscaFeeCents } : {}),
        ...(input.cancellationLimitHours !== undefined ? { cancellationLimitHours: input.cancellationLimitHours } : {}),
        ...(input.simultaneousSlotsDefault !== undefined ? { simultaneousSlotsDefault: input.simultaneousSlotsDefault } : {}),
        ...(input.onlinePaymentsEnabled !== undefined ? { onlinePaymentsEnabled: input.onlinePaymentsEnabled } : {}),
        ...(input.subscriptionsEnabled !== undefined ? { subscriptionsEnabled: input.subscriptionsEnabled } : {}),
        ...(input.maxInstallments !== undefined ? { maxInstallments: input.maxInstallments } : {}),
      },
    });

    return {
      success: true,
      message: 'Configurações atualizadas com sucesso.',
      settings: { ...updated, ...cardInstallments(updated.maxInstallments) },
    };
  }
}
