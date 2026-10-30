import { Controller, Get, Put, Post, Delete, Body, Query, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ScheduleService } from './schedule.service';
import {
  AvailabilityQuerySchema,
  AvailabilityQueryInput,
  UpdateScheduleSchema,
  UpdateScheduleInput,
  ScheduleExceptionSchema,
  ScheduleExceptionInput,
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

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/schedule/exceptions')
  @ApiOperation({ summary: 'Dias especiais (horários extras e fechamentos) de hoje em diante' })
  async listExceptions() {
    return this.scheduleService.listExceptions();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/schedule/exceptions')
  @ApiOperation({ summary: 'Abrir horário extra ou fechar dia/período numa data' })
  async createException(
    @Body(new ZodValidationPipe(ScheduleExceptionSchema)) body: ScheduleExceptionInput,
  ) {
    return this.scheduleService.createException(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete('admin/schedule/exceptions/:id')
  @ApiOperation({ summary: 'Remover dia especial (a data volta à grade semanal)' })
  async deleteException(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduleService.deleteException(id);
  }
}
