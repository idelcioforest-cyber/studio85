import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

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

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
    };
  }
}
