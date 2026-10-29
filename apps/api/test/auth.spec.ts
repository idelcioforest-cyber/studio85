import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserRole } from '@autowash/shared';

describe('AuthService (Integration with DB)', () => {
  let authService: AuthService;
  let prisma: PrismaService;

  const testEmail = `test.user.${Date.now()}@autowash.local`;
  // CPF válido gerado para testes (ex: 111.444.777-35)
  const testCPF = '11144477735';

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test_jwt_secret_for_unit_tests_32_chars_long',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      providers: [AuthService, PrismaService],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    // Limpeza dos dados de teste
    await prisma.user.deleteMany({
      where: { email: { contains: 'test.user.' } },
    });
    await prisma.$disconnect();
  });

  it('1. Deve registrar um novo cliente com sucesso e salvar dados cifrados', async () => {
    const result = await authService.register({
      name: 'Cliente Teste Integrado',
      email: testEmail,
      phone: '11988887777',
      cpf: testCPF,
      password: 'SenhaForte@2026',
      acceptTerms: true,
    });

    expect(result.success).toBe(true);
    expect(result.user.email).toBe(testEmail);

    // Verifica integridade e segurança no banco
    const savedUser = await prisma.user.findUnique({
      where: { email: testEmail },
      include: { roles: { include: { role: true } } },
    });

    expect(savedUser).toBeDefined();
    expect(savedUser!.status).toBe('PENDING_VERIFICATION');
    expect(savedUser!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(savedUser!.cpfEncrypted).not.toBe(testCPF); // Deve estar cifrado
    expect(savedUser!.cpfLookupHash).toBeDefined();
    expect(savedUser!.emailVerificationCode).toHaveLength(6);
    expect(savedUser!.roles[0].role.name).toBe(UserRole.CLIENT);
  });

  it('2. Não deve permitir duplicidade de cadastro com o mesmo e-mail ou CPF', async () => {
    await expect(
      authService.register({
        name: 'Tentativa Duplicada',
        email: testEmail,
        phone: '11988887777',
        cpf: testCPF,
        password: 'SenhaForte@2026',
        acceptTerms: true,
      }),
    ).rejects.toThrow('Já existe uma conta cadastrada');
  });

  it('3. Deve ativar a conta ao enviar o código correto de 6 dígitos', async () => {
    const userBefore = await prisma.user.findUnique({
      where: { email: testEmail },
      select: { emailVerificationCode: true },
    });

    expect(userBefore?.emailVerificationCode).toBeDefined();

    const result = await authService.verifyEmail({
      email: testEmail,
      code: userBefore!.emailVerificationCode!,
    });

    expect(result.success).toBe(true);

    const userAfter = await prisma.user.findUnique({
      where: { email: testEmail },
    });

    expect(userAfter?.status).toBe('ACTIVE');
    expect(userAfter?.emailVerifiedAt).toBeDefined();
    expect(userAfter?.emailVerificationCode).toBeNull();
  });

  it('4. Deve autenticar com credenciais corretas e emitir JWT', async () => {
    const result = await authService.login({
      email: testEmail,
      password: 'SenhaForte@2026',
    });

    expect(result.success).toBe(true);
    expect(result.accessToken).toBeDefined();
    expect(result.user.email).toBe(testEmail);
    expect(result.user.roles).toContain(UserRole.CLIENT);
  });

  it('5. Não deve autenticar com senha incorreta', async () => {
    await expect(
      authService.login({
        email: testEmail,
        password: 'SenhaErrada@9999',
      }),
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('6. Deve retornar o perfil do usuário logado através do getMe', async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    const me = await authService.getMe(user!.id);

    expect(me.id).toBe(user!.id);
    expect(me.email).toBe(testEmail);
    expect(me.roles[0].role.name).toBe(UserRole.CLIENT);
  });
});
