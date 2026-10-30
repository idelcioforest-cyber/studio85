import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RegisterSchema,
  RegisterInput,
  LoginSchema,
  LoginInput,
  VerifyEmailSchema,
  VerifyEmailInput,
  ResendCodeSchema,
  ResendCodeInput,
  ForgotPasswordSchema,
  ForgotPasswordInput,
  ResetPasswordSchema,
  ResetPasswordInput,
  CompleteProfileSchema,
  CompleteProfileInput,
} from '@autowash/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Autenticação & Contas')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Autocadastro de cliente' })
  @ApiResponse({ status: 201, description: 'Cadastro iniciado com sucesso' })
  @ApiResponse({ status: 409, description: 'Dados já cadastrados no sistema' })
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.register(body, ip, userAgent);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validação do código de e-mail de 6 dígitos' })
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) body: VerifyEmailInput,
  ) {
    return this.authService.verifyEmail(body);
  }

  @Public()
  @Post('resend-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reenvio de código de verificação' })
  async resendCode(
    @Body(new ZodValidationPipe(ResendCodeSchema)) body: ResendCodeInput,
  ) {
    return this.authService.resendVerificationCode(body);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Envia por e-mail o código para criar uma nova senha' })
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) body: ForgotPasswordInput,
  ) {
    return this.authService.forgotPassword(body);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cria a nova senha com o código recebido por e-mail' })
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) body: ResetPasswordInput,
  ) {
    return this.authService.resetPassword(body);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login seguro de usuário' })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(body);

    // Cookie seguro HttpOnly/SameSite para proteção contra roubo de tokens via XSS
    res.cookie('autowash_access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24, // 1 dia
    });

    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout e revogação da sessão' })
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('autowash_access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return {
      success: true,
      message: 'Sessão encerrada com sucesso.',
    };
  }

  @Post('complete-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Primeiro acesso: trocar a senha provisória e completar os dados' })
  async completeProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CompleteProfileSchema)) body: CompleteProfileInput,
    @Req() req: Request,
  ) {
    return this.authService.completeProfile(user.id, body, req.ip || req.socket.remoteAddress, req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user.id);
  }
}
