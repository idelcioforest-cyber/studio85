import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { toZonedDateString } from '../../common/utils/timezone.util';

// O dia conta no fuso da loja (o mesmo das telas do painel)
const ACTIVITY_TIMEZONE = 'America/Sao_Paulo';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // 1. Extração prioritária via Cookie seguro HttpOnly
        (req: Request) => {
          let token = null;
          if (req && req.cookies) {
            token = req.cookies['autowash_access_token'];
          }
          return token;
        },
        // 2. Extração via cabeçalho Authorization Bearer (para clientes mobile / API)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production_min_32_chars_long',
    });
  }

  // Último dia já gravado de cada usuário: grava no banco só a primeira requisição do dia
  private readonly activeDay = new Map<string, string>();

  /** Marca que o usuário usou o app logado hoje (indicador "usuários que entraram" do super admin) */
  private recordActivity(userId: string) {
    const day = toZonedDateString(new Date(), ACTIVITY_TIMEZONE);
    if (this.activeDay.get(userId) === day) return;
    this.activeDay.set(userId, day);
    this.prisma.userActivityDay
      .createMany({ data: [{ userId, day }], skipDuplicates: true })
      .catch(() => this.activeDay.delete(userId));
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user || user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
      throw new UnauthorizedException('Usuário inativo ou inexistente');
    }

    const roles = user.roles.map((r) => r.role.name);
    this.recordActivity(user.id);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
    };
  }
}
