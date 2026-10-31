import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformOverviewQuery, PlatformOverviewQuerySchema, SiteEventInput, SiteEventSchema, UserRole } from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PlatformService } from './platform.service';

@ApiTags('Plataforma')
@Controller()
export class PlatformController {
  constructor(private platform: PlatformService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('analytics/events')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Medição anônima de uso (visita e etapas do agendamento)' })
  async event(@Body(new ZodValidationPipe(SiteEventSchema)) body: SiteEventInput, @Headers('user-agent') userAgent?: string) {
    await this.platform.recordEvent(body, userAgent);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('super/overview')
  @ApiOperation({ summary: 'Indicadores do dono da plataforma' })
  async overview(@Query(new ZodValidationPipe(PlatformOverviewQuerySchema)) query: PlatformOverviewQuery) {
    return this.platform.overview(query.days);
  }
}
