import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsSummaryQueryInput, PaymentsSummaryQuerySchema, UserRole } from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RevenueService } from './revenue.service';

@ApiTags('Receita')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class RevenueController {
  constructor(private revenue: RevenueService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/revenue')
  @ApiOperation({ summary: 'Receita do período: indicadores, demonstrativo, gráficos e comparação com o período anterior' })
  report(@Query(new ZodValidationPipe(PaymentsSummaryQuerySchema)) query: PaymentsSummaryQueryInput) {
    return this.revenue.report(query.from, query.to);
  }
}
