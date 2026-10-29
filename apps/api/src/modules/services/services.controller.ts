import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServicesService } from './services.service';
import {
  CreateServiceCategorySchema,
  CreateServiceCategoryInput,
  UpdateServiceCategorySchema,
  UpdateServiceCategoryInput,
  CreateServiceSchema,
  CreateServiceInput,
  UpdateServiceSchema,
  UpdateServiceInput,
  UserRole,
  VehicleSizeCategory,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Catálogo de Serviços & Preços')
@Controller()
export class ServicesController {
  constructor(private servicesService: ServicesService) {}

  @Public()
  @Get('services')
  @ApiOperation({ summary: 'Catálogo público de serviços (com filtro de porte de veículo)' })
  async findAllPublic(@Query('sizeCategory') sizeCategory?: VehicleSizeCategory) {
    return this.servicesService.findAllPublic(sizeCategory);
  }

  @Public()
  @Get('services/:id')
  @ApiOperation({ summary: 'Detalhes de um serviço específico' })
  async findById(@Param('id') id: string) {
    return this.servicesService.findServiceById(id);
  }

  // --- Rotas Administrativas ---

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('admin/services')
  @ApiOperation({ summary: 'Catálogo completo para gestão (inclui serviços pausados)' })
  async adminFindAll() {
    return this.servicesService.adminFindAll();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/service-categories')
  @ApiOperation({ summary: 'Criar nova categoria de serviço' })
  async createCategory(
    @Body(new ZodValidationPipe(CreateServiceCategorySchema)) body: CreateServiceCategoryInput,
  ) {
    return this.servicesService.createCategory(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch('admin/service-categories/:id')
  @ApiOperation({ summary: 'Atualizar categoria de serviço' })
  async updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateServiceCategorySchema)) body: UpdateServiceCategoryInput,
  ) {
    return this.servicesService.updateCategory(id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete('admin/service-categories/:id')
  @ApiOperation({ summary: 'Excluir categoria de serviço' })
  async deleteCategory(@Param('id') id: string) {
    return this.servicesService.deleteCategory(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('admin/services')
  @ApiOperation({ summary: 'Criar serviço com regras de preço por porte' })
  async createService(
    @Body(new ZodValidationPipe(CreateServiceSchema)) body: CreateServiceInput,
  ) {
    return this.servicesService.createService(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch('admin/services/:id')
  @ApiOperation({ summary: 'Atualizar serviço e regras de preço' })
  async updateService(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateServiceSchema)) body: UpdateServiceInput,
  ) {
    return this.servicesService.updateService(id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete('admin/services/:id')
  @ApiOperation({ summary: 'Desativar serviço' })
  async deleteService(@Param('id') id: string) {
    return this.servicesService.deleteService(id);
  }
}
