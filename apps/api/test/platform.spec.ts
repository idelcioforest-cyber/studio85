import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@autowash/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PlatformService } from '../src/modules/platform/platform.service';
import { toZonedDateString } from '../src/common/utils/timezone.util';

/**
 * Área do dono da plataforma: só o SUPER_ADMIN entra (nem o administrador do lava-jato),
 * o acesso diário dos clientes é registrado e o funil conta cada aba uma vez por etapa por dia.
 */
describe('Super admin: acesso e indicadores', () => {
  const prisma = new PrismaService();
  const platform = new PlatformService(prisma);
  const tag = Date.now();
  const ids = { client: '', pending: '', staff: '' };
  const sessions = [`s${tag}a000000000`, `s${tag}b000000000`];
  const browser = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile/15E148';

  const contextFor = (roles: string[]) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', roles } }) }),
    }) as unknown as ExecutionContext;
  const guardFor = (required: UserRole[]) => new RolesGuard({ getAllAndOverride: () => required } as unknown as Reflector);

  beforeAll(async () => {
    const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
    const mk = (name: string, status: 'ACTIVE' | 'PENDING_VERIFICATION', roleNames: string[]) =>
      prisma.user.create({
        data: {
          name,
          email: `${name.toLowerCase().replace(/\s/g, '.')}.${tag}@studio85.test`,
          passwordHash: 'x',
          status,
          roles: { create: roleNames.map((r) => ({ roleId: roles[r] })) },
        },
      });
    ids.client = (await mk('CLIENTE PLATAFORMA', 'ACTIVE', ['CLIENT'])).id;
    ids.pending = (await mk('CLIENTE PELA METADE', 'PENDING_VERIFICATION', ['CLIENT'])).id;
    ids.staff = (await mk('EQUIPE PLATAFORMA', 'ACTIVE', ['CLIENT', 'ADMIN'])).id;
  });

  afterAll(async () => {
    await prisma.siteEvent.deleteMany({ where: { sessionId: { in: sessions } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it('1. Só o SUPER_ADMIN entra; o administrador do lava-jato continua com o painel dele', () => {
    expect(() => guardFor([UserRole.SUPER_ADMIN]).canActivate(contextFor(['ADMIN']))).toThrow(ForbiddenException);
    expect(guardFor([UserRole.SUPER_ADMIN]).canActivate(contextFor(['ADMIN', 'SUPER_ADMIN']))).toBe(true);
    expect(guardFor([UserRole.ADMIN, UserRole.MANAGER]).canActivate(contextFor(['ADMIN']))).toBe(true);
  });

  it('2. Cliente logado fica registrado uma vez por dia; equipe não entra nos números', async () => {
    const today = toZonedDateString(new Date(), 'America/Sao_Paulo');
    const before = await platform.overview(7);
    const strategy = new JwtStrategy(prisma);
    await strategy.validate({ sub: ids.client, email: '', roles: [] });
    await strategy.validate({ sub: ids.client, email: '', roles: [] });
    await strategy.validate({ sub: ids.staff, email: '', roles: [] });
    // A gravação não segura a requisição: espera ela terminar
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.userActivityDay.count({ where: { userId: ids.client, day: today } })).toBe(1);

    const after = await platform.overview(7);
    expect(after.users.activeToday - before.users.activeToday).toBeGreaterThanOrEqual(1);
    expect(after.unfinishedSignups.map((u) => u.name)).toContain('CLIENTE PELA METADE');
    expect(after.unfinishedSignups.find((u) => u.name === 'CLIENTE PELA METADE')?.reason).toBe('Não confirmou o e-mail');
    expect(after.unfinishedSignups.map((u) => u.name)).not.toContain('EQUIPE PLATAFORMA');
  });

  it('3. Funil: cada aba conta uma vez por etapa no dia; robô não conta', async () => {
    const before = (await platform.overview(7)).funnel;
    for (const type of ['visit', 'booking_open', 'booking_slot', 'booking_done'] as const) {
      await platform.recordEvent({ type, sessionId: sessions[0] }, browser);
    }
    await platform.recordEvent({ type: 'visit', sessionId: sessions[0] }, browser); // repetida
    await platform.recordEvent({ type: 'visit', sessionId: sessions[1] }, browser);
    await platform.recordEvent({ type: 'booking_open', sessionId: sessions[1] }, browser);
    await platform.recordEvent({ type: 'visit', sessionId: `bot${tag}0000000000` }, 'Googlebot/2.1 (+http://www.google.com/bot.html)');

    const after = (await platform.overview(7)).funnel;
    expect(after.visits - before.visits).toBe(2);
    expect(after.bookingOpen - before.bookingOpen).toBe(2);
    expect(after.bookingSlot - before.bookingSlot).toBe(1);
    expect(after.bookingDone - before.bookingDone).toBe(1);
    // Abriu o agendamento e não confirmou: a segunda aba
    expect(after.abandoned - before.abandoned).toBe(1);
  });
});
