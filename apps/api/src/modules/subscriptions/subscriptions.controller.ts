import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ActivateSubscriptionInput,
  ActivateSubscriptionSchema,
  CancelSubscriptionInput,
  CancelSubscriptionSchema,
  SubscriptionPlanInput,
  SubscriptionPlanSchema,
  SubscriptionSetupInput,
  SubscriptionSetupSchema,
  UserRole,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionsService } from './subscriptions.service';

const TOKEN_REGEX = /^[A-Za-z0-9_-]{20,64}$/;
const checkToken = (token: string) => {
  if (!TOKEN_REGEX.test(token)) throw new NotFoundException('Link inválido. Peça um novo ao lava-jato.');
  return token;
};

@ApiTags('Assinaturas')
@Controller()
export class SubscriptionsController {
  constructor(private subscriptions: SubscriptionsService) {}

  // ---------------------------------------------------------------- link do cliente (sem login)

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('subscriptions/setup/:token')
  @ApiOperation({ summary: 'Dados do plano para o cliente cadastrar o cartão (link enviado pelo dono)' })
  setupView(@Param('token') token: string) {
    return this.subscriptions.setupView(checkToken(token));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('subscriptions/setup/:token')
  @ApiOperation({ summary: 'Cadastrar o cartão e iniciar a cobrança mensal no Pagar.me' })
  setupSubmit(@Param('token') token: string, @Body(new ZodValidationPipe(SubscriptionSetupSchema)) body: SubscriptionSetupInput) {
    return this.subscriptions.setupSubmit(checkToken(token), body);
  }

  // ---------------------------------------------------------------- cliente logado

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('subscriptions/mine')
  @ApiOperation({ summary: 'Assinaturas ativas do cliente (lista vazia para quem não assina)' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.mine(user.id);
  }

  // ---------------------------------------------------------------- painel

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/subscriptions/plans')
  @ApiOperation({ summary: 'Planos montados pelo dono' })
  plans() {
    return this.subscriptions.listPlans();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/subscriptions/plans')
  @ApiOperation({ summary: 'Criar plano (até 4 serviços, lavagens por mês e preço por porte)' })
  createPlan(@Body(new ZodValidationPipe(SubscriptionPlanSchema)) body: SubscriptionPlanInput) {
    return this.subscriptions.createPlan(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/subscriptions/plans/:id')
  @ApiOperation({ summary: 'Alterar plano (quem já assina mantém as regras da ativação)' })
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(SubscriptionPlanSchema)) body: SubscriptionPlanInput) {
    return this.subscriptions.updatePlan(id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('admin/subscriptions/plans/:id')
  @ApiOperation({ summary: 'Excluir plano nunca usado' })
  deletePlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.deletePlan(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/subscriptions')
  @ApiOperation({ summary: 'Assinantes, uso do mês e situação da cobrança' })
  list() {
    return this.subscriptions.list();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/subscriptions')
  @ApiOperation({ summary: 'Ativar plano para um cliente e gerar o link do cartão' })
  activate(@Body(new ZodValidationPipe(ActivateSubscriptionSchema)) body: ActivateSubscriptionInput) {
    return this.subscriptions.activate(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/subscriptions/:id/link')
  @ApiOperation({ summary: 'Gerar novo link do cartão (o anterior para de funcionar)' })
  regenerateLink(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.regenerateLink(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/subscriptions/:id/cancel')
  @ApiOperation({ summary: 'Cancelar assinatura (para as cobranças no Pagar.me)' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CancelSubscriptionSchema)) body: CancelSubscriptionInput) {
    return this.subscriptions.cancel(id, body.reason ?? null);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/subscriptions/:id/refresh')
  @ApiOperation({ summary: 'Consultar a cobrança no Pagar.me agora' })
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.refresh(id);
  }
}
