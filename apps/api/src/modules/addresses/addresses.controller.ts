import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AddressesService } from './addresses.service';
import {
  CreateAddressSchema,
  CreateAddressInput,
  UpdateAddressSchema,
  UpdateAddressInput,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Endereços & Telebusca')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private addressesService: AddressesService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastrar endereço de coleta/entrega do cliente' })
  @ApiResponse({ status: 201, description: 'Endereço cadastrado' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateAddressSchema)) body: CreateAddressInput,
  ) {
    return this.addressesService.create(user.id, body);
  }

  @Get('my')
  @ApiOperation({ summary: 'Listar endereços do cliente autenticado (Telebusca 1 clique)' })
  async findMyAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.addressesService.findMyAddresses(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar dados de um endereço (Anti-IDOR)' })
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addressesService.findById(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar endereço (Anti-IDOR)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateAddressSchema)) body: UpdateAddressInput,
  ) {
    return this.addressesService.update(id, user, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir endereço (Anti-IDOR)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addressesService.remove(id, user);
  }
}
