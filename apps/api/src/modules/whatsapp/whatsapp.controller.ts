import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import * as crypto from 'crypto';
import {
  UpdateMessageTemplateSchema,
  UpdateMessageTemplateInput,
  WhatsAppTestSchema,
  WhatsAppTestInput,
  NotifyAppointmentSchema,
  NotifyAppointmentInput,
  CampaignSchema,
  CampaignInput,
  SendCampaignSchema,
  SendCampaignInput,
  UserRole,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WhatsAppBridgeService } from './whatsapp-bridge.service';
import { NotificationsService, TEMPLATE_VARIABLES } from './notifications.service';
import { CampaignsService } from './campaigns.service';

@ApiTags('WhatsApp')
@Controller()
export class WhatsAppController {
  constructor(
    private bridge: WhatsAppBridgeService,
    private notifications: NotificationsService,
    private campaigns: CampaignsService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/whatsapp/status')
  @ApiOperation({ summary: 'Situação do número de WhatsApp do estabelecimento' })
  async status() {
    return this.bridge.getStatus();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/whatsapp/connect')
  @ApiOperation({ summary: 'Iniciar conexão do número (devolve o QR code)' })
  async connect() {
    return this.bridge.connect();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/whatsapp/qr')
  @ApiOperation({ summary: 'QR code atual e situação da conexão' })
  async qr() {
    return this.bridge.getQr();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete('admin/whatsapp/connection')
  @ApiOperation({ summary: 'Desconectar o número' })
  async disconnect() {
    return this.bridge.disconnect();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/whatsapp/templates')
  @ApiOperation({ summary: 'Mensagens automáticas e variáveis disponíveis' })
  async templates() {
    return { variables: TEMPLATE_VARIABLES, templates: await this.notifications.listTemplates() };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put('admin/whatsapp/templates/:key')
  @ApiOperation({ summary: 'Editar mensagem automática' })
  async updateTemplate(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateMessageTemplateSchema)) body: UpdateMessageTemplateInput,
  ) {
    return this.notifications.updateTemplate(key, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/whatsapp/test')
  @ApiOperation({ summary: 'Enviar mensagem de teste' })
  async test(@Body(new ZodValidationPipe(WhatsAppTestSchema)) body: WhatsAppTestInput) {
    return this.notifications.sendTest(body.phone);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/whatsapp/campaigns')
  @ApiOperation({ summary: 'Avisos em massa e a fila de envio' })
  async listCampaigns() {
    return this.campaigns.list();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/whatsapp/campaigns')
  @ApiOperation({ summary: 'Criar aviso em massa' })
  async createCampaign(@Body(new ZodValidationPipe(CampaignSchema)) body: CampaignInput) {
    return this.campaigns.create(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/whatsapp/campaigns/:id')
  @ApiOperation({ summary: 'Aviso com os contatos e a situação de cada um' })
  async campaignDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.detail(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put('admin/whatsapp/campaigns/:id')
  @ApiOperation({ summary: 'Editar aviso em massa' })
  async updateCampaign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CampaignSchema)) body: CampaignInput) {
    return this.campaigns.update(id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete('admin/whatsapp/campaigns/:id')
  @ApiOperation({ summary: 'Excluir aviso em massa' })
  async removeCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.remove(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/whatsapp/campaigns/:id/send')
  @ApiOperation({ summary: 'Mandar o aviso para até 20 contatos (um por minuto)' })
  async sendCampaign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(SendCampaignSchema)) body: SendCampaignInput) {
    return this.campaigns.send(id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/whatsapp/campaigns/:id/cancel')
  @ApiOperation({ summary: 'Parar o envio do aviso' })
  async cancelCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.cancel(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Get('admin/whatsapp/messages')
  @ApiOperation({ summary: 'Últimas mensagens enviadas (inclui falhas)' })
  async messages(@Query('limit') limit?: string) {
    return this.notifications.recentMessages(Number(limit) || 30);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Post('admin/appointments/:id/notify')
  @ApiOperation({ summary: 'Enviar mensagem ao cliente agora (ex.: avisar que o carro está pronto)' })
  async notify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(NotifyAppointmentSchema)) body: NotifyAppointmentInput,
  ) {
    return this.notifications.notifyAppointment(id, body.templateKey, { force: true });
  }

  /**
   * Aviso da ponte quando o número conecta/desconecta. Exige o segredo compartilhado
   * (sem segredo configurado, recusa tudo).
   */
  @Public()
  @Post('webhooks/whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook da ponte de WhatsApp' })
  async webhook(
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: { event?: string; instance?: string; data?: { state?: string } },
  ) {
    const expected = process.env.WHATSAPP_WEBHOOK_SECRET || '';
    const received = Buffer.from(String(secret || ''));
    const valid =
      expected.length >= 32 &&
      received.length === Buffer.byteLength(expected) &&
      crypto.timingSafeEqual(received, Buffer.from(expected));
    if (!valid) throw new UnauthorizedException('Assinatura inválida');

    if (body?.event === 'connection.update' && body.instance === this.bridge.instance && body.data?.state) {
      await this.bridge.handleConnectionUpdate(body.data.state);
    }
    return { ok: true };
  }
}
