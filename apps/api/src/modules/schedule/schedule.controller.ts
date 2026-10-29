import { Controller, Get, Put, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ScheduleService } from './schedule.service';
import {
  AvailabilityQuerySchema,
  AvailabilityQueryInput,
  UpdateScheduleSchema,
  UpdateScheduleInput,
  UserRole,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Agenda & Disponibilidade')
@Controller()
export class ScheduleController {
  constructor(private scheduleService: ScheduleService) {}

  @Public()
  @Get('schedule/hours')
  @ApiOperation({ summary: 'Horário de funcionamento público' })
  async getOpeningHours() {
    return this.scheduleService.getOpeningHours();
  }

  @Public()
  @Get('availability')
  @ApiOperation({ summary: 'Horários livres de um dia (sem dados de clientes ou veículos)' })
  async getAvailability(
    @Query(new ZodValidationPipe(AvailabilityQuerySchema)) query: AvailabilityQueryInput,
  ) {
    const duration = await this.scheduleService.resolveDuration(query.serviceIds, query.sizeCategory);
    return this.scheduleService.getAvailability(query.date, duration);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Get('admin/availability')
  @ApiOperation({ summary: 'Horários do dia para a equipe (ocupação e vagas de tolerância)' })
  async getStaffAvailability(
    @Query(new ZodValidationPipe(AvailabilityQuerySchema)) query: AvailabilityQueryInput,
  ) {
    const duration = await this.scheduleService.resolveDuration(query.serviceIds, query.sizeCategory);
    return this.scheduleService.getStaffAvailability(query.date, duration);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/schedule')
  @ApiOperation({ summary: 'Grade semanal de turnos e capacidade' })
  async getWeek() {
    return this.scheduleService.getWeek();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put('admin/schedule')
  @ApiOperation({ summary: 'Atualizar grade semanal de turnos e capacidade' })
  async updateWeek(
    @Body(new ZodValidationPipe(UpdateScheduleSchema)) body: UpdateScheduleInput,
  ) {
    return this.scheduleService.updateWeek(body);
  }
}
