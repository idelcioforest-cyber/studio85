import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import {
  UpdateBusinessSettingsSchema,
  UpdateBusinessSettingsInput,
  UserRole,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Configurações da Empresa & Telebusca')
@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Configurações públicas da empresa (inclui status da telebusca)' })
  async getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin')
  @ApiOperation({ summary: 'Configurações administrativas completas' })
  async getAdminSettings() {
    return this.settingsService.getAdminSettings();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin')
  @ApiOperation({ summary: 'Atualizar configurações administrativas (ex: ativar telebusca)' })
  async updateSettings(
    @Body(new ZodValidationPipe(UpdateBusinessSettingsSchema)) body: UpdateBusinessSettingsInput,
  ) {
    return this.settingsService.updateSettings(body);
  }
}
