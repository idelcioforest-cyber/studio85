import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  RegisterInput,
  LoginInput,
  VerifyEmailInput,
  ResendCodeInput,
  CompleteProfileInput,
  UserRole,
} from '@autowash/shared';
import {
  hashPassword,
  verifyPassword,
  encryptSensitiveData,
  generateLookupHash,
  generateSecureCode,
  timingSafeCompare,
} from '../../common/utils/crypto.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mail: MailService,
  ) {}

  /**
   * Autocadastro de cliente com proteção contra enumeração e hashing Argon2id
   */
  async register(input: RegisterInput, ipAddress?: string, userAgent?: string) {
    const lookupHash = generateLookupHash(input.cpf);

    // Checagem de duplicidade por e-mail ou CPF
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: input.email },
          { cpfLookupHash: lookupHash },
        ],
      },
      select: { id: true, email: true },
    });

    if (existingUser) {
      // Mensagem genérica para evitar enumeração de contas
      throw new ConflictException(
        'Já existe uma conta cadastrada com os dados informados. Tente fazer login ou recuperar a senha.',
      );
    }

    // 1. Criptografa dados sensíveis
    const passwordHash = await hashPassword(input.password);
    const cpfEncrypted = encryptSensitiveData(input.cpf);
    const verificationCode = generateSecureCode();

    // 2. Busca ou cria papel padrão CLIENT
    let clientRole = await this.prisma.role.findUnique({
      where: { name: UserRole.CLIENT },
    });

    if (!clientRole) {
      clientRole = await this.prisma.role.create({
        data: {
          name: UserRole.CLIENT,
          description: 'Cliente final do lava-rápido',
        },
      });
    }

    // 3. Criação atômica do usuário e vínculos
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          cpfEncrypted,
          cpfLookupHash: lookupHash,
          passwordHash,
          status: 'PENDING_VERIFICATION',
          emailVerificationCode: verificationCode,
          emailVerificationSentAt: new Date(),
          roles: {
            create: {
              roleId: clientRole.id,
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
        },
      });

      // Registro de aceite dos Termos de Uso e da Política de Privacidade (LGPD)
      const acceptedDocs = await tx.legalDocument.findMany({
        where: { slug: { in: ['terms_of_use', 'privacy_policy'] }, isActive: true },
      });

      for (const doc of acceptedDocs) {
        await tx.legalAcceptance.create({
          data: {
            userId: newUser.id,
            documentId: doc.id,
            documentVersion: doc.version,
            ipAddress,
            userAgent: userAgent?.slice(0, 255),
          },
        });
      }

      return newUser;
    });

    // A conta já existe: se o e-mail falhar, o cliente pede outro código na mesma tela
    let mailSent = true;
    try {
      await this.mail.sendVerificationCode(user.email!, user.name, verificationCode);
    } catch (error) {
      mailSent = false;
      this.logger.error(`Falha ao enviar o código de verificação para ${user.email}: ${(error as Error).message}`);
    }

    return {
      success: true,
      message: mailSent
        ? 'Cadastro realizado com sucesso. Insira o código enviado ao seu e-mail para ativar a conta.'
        : 'Cadastro realizado, mas não conseguimos enviar o e-mail agora. Toque em "Reenviar código" em instantes.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      // Sem provedor de e-mail em desenvolvimento: devolve o código para permitir testar o fluxo localmente
      ...(process.env.NODE_ENV === 'development' && process.env.MAIL_DRIVER === 'mock'
        ? { devVerificationCode: verificationCode }
        : {}),
    };
  }

  /**
   * Verificação de e-mail por código de uso único (6 dígitos)
   */
  async verifyEmail(input: VerifyEmailInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        email: true,
        status: true,
        emailVerificationCode: true,
        emailVerificationSentAt: true,
      },
    });

    if (!user || !user.emailVerificationCode) {
      throw new BadRequestException('Código de verificação inválido ou expirado.');
    }

    // Valida expiração do código (15 minutos)
    const now = new Date();
    const sentAt = user.emailVerificationSentAt ? new Date(user.emailVerificationSentAt) : new Date(0);
    const diffMinutes = (now.getTime() - sentAt.getTime()) / (1000 * 60);

    if (diffMinutes > 15) {
      throw new BadRequestException('O código expirou. Solicite um novo código de verificação.');
    }

    // Comparação em tempo constante (anti-timing attack)
    const isValidCode = timingSafeCompare(user.emailVerificationCode, input.code);
    if (!isValidCode) {
      throw new BadRequestException('Código de verificação incorreto.');
    }

    // Ativação da conta
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'ACTIVE',
        emailVerifiedAt: now,
        emailVerificationCode: null,
      },
    });

    return {
      success: true,
      message: 'E-mail verificado com sucesso. Você já pode acessar a plataforma.',
    };
  }

  /**
   * Reenvio de código de verificação com cooldown de 60 segundos
   */
  async resendVerificationCode(input: ResendCodeInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        emailVerifiedAt: true,
        emailVerificationSentAt: true,
      },
    });

    // Se o usuário não existir ou já estiver verificado, responde com sucesso genérico (evita enumeração)
    if (!user || user.emailVerifiedAt) {
      return {
        success: true,
        message: 'Se a conta existir e estiver pendente, um novo código foi enviado.',
      };
    }

    // Cooldown de 60 segundos
    if (user.emailVerificationSentAt) {
      const diffSeconds = (Date.now() - new Date(user.emailVerificationSentAt).getTime()) / 1000;
      if (diffSeconds < 60) {
        throw new BadRequestException(
          `Aguarde ${Math.ceil(60 - diffSeconds)} segundos antes de solicitar um novo código.`,
        );
      }
    }

    const newCode = generateSecureCode();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCode: newCode,
        emailVerificationSentAt: new Date(),
      },
    });

    try {
      await this.mail.sendVerificationCode(user.email!, user.name, newCode);
    } catch (error) {
      this.logger.error(`Falha ao reenviar o código de verificação para ${user.email}: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Não foi possível enviar o e-mail agora. Tente novamente em 1 minuto.');
    }

    return {
      success: true,
      message: 'Novo código de verificação enviado.',
      ...(process.env.NODE_ENV === 'development' && process.env.MAIL_DRIVER === 'mock'
        ? { devVerificationCode: newCode }
        : {}),
    };
  }

  /**
   * Login seguro com verificação de credenciais e geração de tokens
   */
  async login(input: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const isPasswordValid = await verifyPassword(user.passwordHash, input.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    if (user.status === 'PENDING_VERIFICATION') {
      throw new UnauthorizedException('Sua conta ainda não foi ativada. Verifique o código em seu e-mail.');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Sua conta está desativada ou suspensa. Contate o suporte.');
    }

    const roles = user.roles.map((r) => r.role.name);

    const payload = {
      sub: user.id,
      email: user.email,
      roles,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      success: true,
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles,
        mustChangePassword: user.mustChangePassword,
        profileIncomplete: user.profileIncomplete,
      },
    };
  }

  /**
   * Primeiro acesso de cliente cadastrado pela equipe: troca a senha provisória e completa os dados
   */
  async completeProfile(userId: string, input: CompleteProfileInput, ipAddress?: string, userAgent?: string) {
    const lookupHash = generateLookupHash(input.cpf);
    const cpfOwner = await this.prisma.user.findFirst({
      where: { cpfLookupHash: lookupHash, NOT: { id: userId } },
      select: { id: true },
    });
    if (cpfOwner) {
      throw new ConflictException('Este CPF já está cadastrado em outra conta. Fale com o Studio 85.');
    }

    const passwordHash = await hashPassword(input.newPassword);
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          phone: input.phone,
          cpfEncrypted: encryptSensitiveData(input.cpf),
          cpfLookupHash: lookupHash,
          passwordHash,
          mustChangePassword: false,
          profileIncomplete: false,
        },
        include: { roles: { include: { role: true } } },
      });

      const docs = await tx.legalDocument.findMany({
        where: { slug: { in: ['terms_of_use', 'privacy_policy'] }, isActive: true },
      });
      for (const doc of docs) {
        await tx.legalAcceptance.create({
          data: {
            userId,
            documentId: doc.id,
            documentVersion: doc.version,
            ipAddress,
            userAgent: userAgent?.slice(0, 255),
          },
        });
      }
      return updated;
    });

    return {
      success: true,
      message: 'Cadastro concluído. Sua nova senha já está valendo.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.roles.map((r) => r.role.name),
        mustChangePassword: false,
        profileIncomplete: false,
      },
    };
  }

  /**
   * Obtém os dados completos do usuário logado
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        addresses: {
          orderBy: { isDefault: 'desc' },
        },
        vehicles: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    return user;
  }
}
