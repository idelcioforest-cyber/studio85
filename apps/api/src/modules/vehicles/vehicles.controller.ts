import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import {
  CreateVehicleSchema,
  CreateVehicleInput,
  UpdateVehicleSchema,
  UpdateVehicleInput,
  UserRole,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Garagem & Veículos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Post('vehicles')
  @ApiOperation({ summary: 'Cadastrar novo veículo na garagem do cliente' })
  @ApiResponse({ status: 201, description: 'Veículo cadastrado' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateVehicleSchema)) body: CreateVehicleInput,
  ) {
    return this.vehiclesService.create(user.id, body);
  }

  @Get('vehicles/my')
  @ApiOperation({ summary: 'Listar veículos do cliente autenticado' })
  async findMyVehicles(@CurrentUser() user: AuthenticatedUser) {
    return this.vehiclesService.findMyVehicles(user.id);
  }

  @Get('vehicles/:id')
  @ApiOperation({ summary: 'Buscar dados de um veículo (Anti-IDOR)' })
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vehiclesService.findById(id, user);
  }

  @Patch('vehicles/:id')
  @ApiOperation({ summary: 'Atualizar veículo da garagem (Anti-IDOR)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateVehicleSchema)) body: UpdateVehicleInput,
  ) {
    return this.vehiclesService.update(id, user, body);
  }

  @Delete('vehicles/:id')
  @ApiOperation({ summary: 'Remover veículo da garagem (Anti-IDOR)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vehiclesService.remove(id, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Get('admin/vehicles')
  @ApiOperation({ summary: 'Busca administrativa de veículos com filtros' })
  async adminFindAll(
    @Query('search') search?: string,
    @Query('sizeCategory') sizeCategory?: any,
  ) {
    return this.vehiclesService.adminFindAll(search, sizeCategory);
  }
}
