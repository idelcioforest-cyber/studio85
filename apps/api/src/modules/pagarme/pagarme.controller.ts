import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  CardPaymentInput,
  CardPaymentSchema,
  PaymentRecipientInput,
  PaymentRecipientSchema,
  PaymentsSummaryQueryInput,
  PaymentsSummaryQuerySchema,
  RefundPaymentInput,
  RefundPaymentSchema,
  UserRole,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PagarmePaymentsService } from './pagarme-payments.service';
import { PagarmeRecipientService } from './pagarme-recipient.service';
import { PagarmeWebhookService } from './pagarme-webhook.service';

@ApiTags('Pagamento online (Pagar.me)')
@Controller()
export class PagarmeController {
  constructor(
    private payments: PagarmePaymentsService,
    private recipients: PagarmeRecipientService,
    private webhooks: PagarmeWebhookService,
  ) {}

  // ---------------------------------------------------------------- cliente

  @Public()
  @Get('payments/online/config')
  @ApiOperation({ summary: 'Pagamento online disponível? (e a chave pública para tokenizar o cartão)' })
  onlineConfig() {
    return this.payments.onlineConfig();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('appointments/:id/payments/pix')
  @ApiOperation({ summary: 'Gerar Pix (com split) para pagar o agendamento agora' })
  pix(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.createPix(user.id, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('appointments/:id/payments/card')
  @ApiOperation({ summary: 'Pagar com cartão (só o token do cartão chega ao servidor)' })
  card(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CardPaymentSchema)) body: CardPaymentInput,
  ) {
    return this.payments.createCard(user.id, id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('payments/:id')
  @ApiOperation({ summary: 'Situação do pagamento online (para acompanhar o Pix)' })
  status(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.getForClient(user.id, id);
  }

  // ---------------------------------------------------------------- admin

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/payments/recipient')
  @ApiOperation({ summary: 'Recebedor do lava-jato e situação do Pagar.me' })
  recipient() {
    return this.recipients.adminView();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/payments/recipient')
  @ApiOperation({ summary: 'Cadastrar/atualizar o recebedor (cria no Pagar.me na primeira vez)' })
  saveRecipient(@Body(new ZodValidationPipe(PaymentRecipientSchema)) body: PaymentRecipientInput) {
    return this.recipients.save(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/payments/recipient/kyc-link')
  @ApiOperation({ summary: 'Gerar novo link de verificação de identidade (KYC)' })
  kycLink() {
    return this.recipients.generateKyc();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/payments/recipient/refresh')
  @ApiOperation({ summary: 'Atualizar o status do recebedor consultando o Pagar.me' })
  refreshRecipient() {
    return this.recipients.refreshStatus();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/payments/summary')
  @ApiOperation({ summary: 'Resumo do período: vendido, lava-jato, comissão, pendentes, estornos e chargebacks' })
  summary(@Query(new ZodValidationPipe(PaymentsSummaryQuerySchema)) query: PaymentsSummaryQueryInput) {
    return this.payments.summary(query.from, query.to);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/payments')
  @ApiOperation({ summary: 'Pagamentos online do período' })
  list(@Query(new ZodValidationPipe(PaymentsSummaryQuerySchema)) query: PaymentsSummaryQueryInput) {
    return this.payments.list(query.from, query.to);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/payments/:id/refund')
  @ApiOperation({ summary: 'Estornar pagamento online (total ou parcial)' })
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RefundPaymentSchema)) body: RefundPaymentInput,
  ) {
    return this.payments.refund(id, body, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/payments/webhook-events')
  @ApiOperation({ summary: 'Eventos recebidos do Pagar.me' })
  events() {
    return this.webhooks.list();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/payments/webhook-events/:id/reprocess')
  @ApiOperation({ summary: 'Reprocessar um evento do Pagar.me' })
  reprocess(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.reprocess(id);
  }

  // ---------------------------------------------------------------- webhook

  /** Fora do prefixo /api/v1: é o endereço cadastrado no painel do Pagar.me */
  @Public()
  @SkipThrottle()
  @Post('api/webhook/pagarme')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook do Pagar.me (reconsulta a API antes de agir)' })
  async webhook(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    this.webhooks.assertAuthorized(authorization);
    return this.webhooks.receive(body as Parameters<PagarmeWebhookService['receive']>[0]);
  }
}
