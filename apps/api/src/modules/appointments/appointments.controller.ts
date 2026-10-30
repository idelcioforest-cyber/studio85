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
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { AppointmentsService, UploadedFileData } from './appointments.service';
import { MAX_RECEIPT_BYTES, MAX_PHOTO_BYTES } from '../../common/utils/private-storage.util';
import {
  CreateAppointmentSchema,
  CreateAppointmentInput,
  WalkInAppointmentSchema,
  WalkInAppointmentInput,
  UpdateAppointmentStatusSchema,
  UpdateAppointmentStatusInput,
  AdminAppointmentsQuerySchema,
  AdminAppointmentsQueryInput,
  CustomerSearchQuerySchema,
  CustomerSearchQueryInput,
  PayAppointmentSchema,
  PayAppointmentInput,
  AdminCreateAppointmentSchema,
  AdminCreateAppointmentInput,
  GrantAccessSchema,
  GrantAccessInput,
  PhotoCategorySchema,
  UserRole,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Agendamentos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AppointmentsController {
  constructor(private appointmentsService: AppointmentsService) {}

  @Post('appointments')
  @ApiOperation({ summary: 'Agendar serviço para um veículo da garagem do cliente' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateAppointmentSchema)) body: CreateAppointmentInput,
  ) {
    return this.appointmentsService.create(user.id, body);
  }

  @Get('appointments/my')
  @ApiOperation({ summary: 'Agendamentos do cliente autenticado' })
  async findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.appointmentsService.findMine(user.id);
  }

  @Patch('appointments/:id/cancel')
  @ApiOperation({ summary: 'Cancelar agendamento próprio ainda não iniciado (Anti-IDOR)' })
  async cancelMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointmentsService.cancelMine(user.id, id);
  }

  // --- Rotas da Equipe ---

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Get('admin/appointments')
  @ApiOperation({ summary: 'Agendamentos do dia e veículos em atendimento (pátio)' })
  async adminList(
    @Query(new ZodValidationPipe(AdminAppointmentsQuerySchema)) query: AdminAppointmentsQueryInput,
  ) {
    return this.appointmentsService.adminList(query.date);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Patch('admin/appointments/:id/status')
  @ApiOperation({ summary: 'Avançar etapa do atendimento no pátio' })
  async adminUpdateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateAppointmentStatusSchema)) body: UpdateAppointmentStatusInput,
  ) {
    return this.appointmentsService.adminUpdateStatus(id, body);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Post('admin/appointments/walk-in')
  @ApiOperation({ summary: 'Registrar entrada de cliente de balcão' })
  async adminWalkIn(
    @Body(new ZodValidationPipe(WalkInAppointmentSchema)) body: WalkInAppointmentInput,
  ) {
    return this.appointmentsService.adminWalkIn(body);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Post('admin/appointments')
  @ApiOperation({ summary: 'Agendar pela equipe (ex.: pedido no WhatsApp), com cadastro rápido de cliente novo' })
  async adminCreate(
    @Body(new ZodValidationPipe(AdminCreateAppointmentSchema)) body: AdminCreateAppointmentInput,
  ) {
    return this.appointmentsService.adminCreate(body);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Post('admin/customers/:id/access')
  @ApiOperation({ summary: 'Liberar o app para cliente cadastrado pela equipe (e-mail + senha provisória)' })
  async adminGrantAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(GrantAccessSchema)) body: GrantAccessInput,
  ) {
    return this.appointmentsService.adminGrantAccess(id, body.email);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT, UserRole.WASHER)
  @Post('admin/appointments/:id/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Enviar foto de antes ou depois do atendimento' })
  async adminAddPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('category', new ZodValidationPipe(PhotoCategorySchema)) category: 'BEFORE' | 'AFTER',
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedFileData,
  ) {
    return this.appointmentsService.adminAddPhoto(id, category, file, user.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT, UserRole.WASHER)
  @Delete('admin/photos/:photoId')
  @ApiOperation({ summary: 'Remover foto do atendimento' })
  async adminDeletePhoto(@Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.appointmentsService.adminDeletePhoto(photoId);
  }

  @Get('photos/:photoId')
  @ApiOperation({ summary: 'Ver foto (equipe ou o próprio cliente do atendimento)' })
  async getPhoto(
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const photo = await this.appointmentsService.getPhotoFile(photoId, user);
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(photo.path);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Get('admin/customers/search')
  @ApiOperation({ summary: 'Buscar cliente por nome, telefone, e-mail ou placa (entrada de balcão)' })
  async adminSearchCustomers(
    @Query(new ZodValidationPipe(CustomerSearchQuerySchema)) query: CustomerSearchQueryInput,
  ) {
    return this.appointmentsService.adminSearchCustomers(query.q);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Post('admin/appointments/:id/pay')
  @ApiOperation({ summary: 'Registrar pagamento na retirada (Pix, cartão ou dinheiro)' })
  async adminPay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(PayAppointmentSchema)) body: PayAppointmentInput,
  ) {
    return this.appointmentsService.adminPay(id, body);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Delete('admin/appointments/:id/pay')
  @ApiOperation({ summary: 'Desfazer recebimento lançado por engano (somente no mesmo dia)' })
  async adminUnpay(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointmentsService.adminUnpay(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Post('admin/appointments/:id/receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Anexar comprovante de Pix/cartão pago fora do sistema (foto ou PDF, até 5 MB)' })
  async adminAttachReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: UploadedFileData,
  ) {
    return this.appointmentsService.adminAttachReceipt(id, file);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Delete('admin/appointments/:id/receipt')
  @ApiOperation({ summary: 'Remover comprovante anexado' })
  async adminRemoveReceipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointmentsService.adminRemoveReceipt(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Get('admin/appointments/:id/receipt')
  @ApiOperation({ summary: 'Ver comprovante (somente equipe)' })
  async adminGetReceipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const receipt = await this.appointmentsService.adminGetReceipt(id);
    res.setHeader('Content-Type', receipt.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${receipt.fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(receipt.path);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ATTENDANT)
  @Get('admin/cash')
  @ApiOperation({ summary: 'Caixa do dia: recebidos por forma de pagamento e atendimentos a receber' })
  async adminCash(
    @Query(new ZodValidationPipe(AdminAppointmentsQuerySchema)) query: AdminAppointmentsQueryInput,
  ) {
    return this.appointmentsService.adminCash(query.date);
  }
}
