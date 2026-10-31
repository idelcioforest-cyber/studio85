import { PrismaClient } from '@prisma/client';
import * as argon2 from '@node-rs/argon2';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function getEncryptionKey(): Buffer {
  const hexKey = process.env.DATA_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  return Buffer.from(hexKey, 'hex');
}

function encryptCPF(cpf: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(cpf, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function hashCPF(cpf: string): string {
  const salt = process.env.DATA_ENCRYPTION_SALT || 'autowash_cpf_lookup_salt_default';
  return crypto.createHmac('sha256', salt).update(cpf.trim()).digest('hex');
}

async function main() {
  console.log('Iniciando seed do banco de dados (lavagem)...');

  // 1. Roles
  const roles = [
    { name: 'ADMIN', description: 'Administrador proprietário com acesso total funcional' },
    { name: 'MANAGER', description: 'Gerente operacional e de equipe' },
    { name: 'ATTENDANT', description: 'Atendente da recepção e check-in' },
    { name: 'WASHER', description: 'Lavador e técnico operacional' },
    { name: 'CLIENT', description: 'Cliente do lava-rápido' },
    { name: 'SUPER_ADMIN', description: 'Dono da plataforma: indicadores de uso' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }
  console.log('✓ Papéis (Roles) sincronizados');

  // 2. Configurações de Negócio
  const settings = await prisma.businessSettings.findFirst();
  if (!settings) {
    await prisma.businessSettings.create({
      data: {
        companyName: 'Studio 85',
        tradeName: 'Estética Automotiva',
        phone: '555192198686',
        address: 'R. Amapá, 16 - Cavalhada, Porto Alegre - RS, 91740-460',
        telebuscaEnabled: false, // Inicia desativado até liberação no admin
        telebuscaFeeCents: 2000,  // Taxa base R$ 20,00 quando ativo
        cancellationLimitHours: 4, // Regra comercial de 4 horas
        simultaneousSlotsDefault: 2, // 2 veículos simultâneos por padrão
      },
    });
    console.log('✓ Configurações da empresa criadas');
  }

  // 3. Agenda Semanal e Turnos (Modelo Luara com flexibilidade para lava-rápido)
  // Domingo (0) a Sábado (6)
  const scheduleDefaults = [
    { day: 0, active: false, interval: 60 }, // Domingo fechado
    { day: 1, active: true, interval: 60 },  // Segunda
    { day: 2, active: true, interval: 60 },  // Terça
    { day: 3, active: true, interval: 60 },  // Quarta
    { day: 4, active: true, interval: 60 },  // Quinta
    { day: 5, active: true, interval: 60 },  // Sexta
    { day: 6, active: true, interval: 60 },  // Sábado
  ];

  for (const item of scheduleDefaults) {
    const schedule = await prisma.businessSchedule.upsert({
      where: { dayOfWeek: item.day },
      update: {
        isActive: item.active,
        slotIntervalMinutes: item.interval,
      },
      create: {
        dayOfWeek: item.day,
        isActive: item.active,
        slotIntervalMinutes: item.interval,
      },
    });

    // Turnos para cada dia: Manhã (08:00 - 12:00), Tarde (13:00 - 18:00), Noite (18:00 - 21:00)
    const shifts = [
      { name: 'MANHA', start: '08:00', end: '12:00', capacity: item.day === 6 ? 3 : 2, active: item.active },
      { name: 'TARDE', start: '13:00', end: '18:00', capacity: item.day === 6 ? 3 : 2, active: item.active },
      { name: 'NOITE', start: '18:00', end: '21:00', capacity: 1, active: false },
    ];

    for (const shift of shifts) {
      const existingShift = await prisma.scheduleShift.findFirst({
        where: { businessScheduleId: schedule.id, shiftName: shift.name },
      });

      if (!existingShift) {
        await prisma.scheduleShift.create({
          data: {
            businessScheduleId: schedule.id,
            shiftName: shift.name,
            startTime: shift.start,
            endTime: shift.end,
            simultaneousCapacity: shift.capacity,
            isActive: shift.active,
          },
        });
      }
    }
  }
  console.log('✓ Grade de horários e turnos operacionais sincronizados');

  // 4. Categorias de Serviços e Serviços Iniciais
  let catLavagem = await prisma.serviceCategory.findFirst({ where: { name: 'Lavagens' } });
  if (!catLavagem) {
    catLavagem = await prisma.serviceCategory.create({
      data: {
        name: 'Lavagens',
        description: 'Serviços de limpeza externa e interna',
        icon: 'droplets',
        displayOrder: 1,
      },
    });

    // Serviços com snapshot de precificação por porte
    const s1 = await prisma.service.create({
      data: {
        categoryId: catLavagem.id,
        name: 'Lavagem Simples',
        description: 'Ducha externa com shampoo neutro, aspiração interna rápida e secagem.',
        basePriceCents: 7000, // R$ 70,00 (Sedan/Médio)
        baseDurationMinutes: 85,
        isActive: true,
      },
    });

    await prisma.servicePriceRule.createMany({
      data: [
        { serviceId: s1.id, sizeCategory: 'SMALL', priceCents: 6000, durationMinutes: 75 },
        { serviceId: s1.id, sizeCategory: 'MEDIUM', priceCents: 7000, durationMinutes: 85 },
        { serviceId: s1.id, sizeCategory: 'SUV', priceCents: 8000, durationMinutes: 105 },
        { serviceId: s1.id, sizeCategory: 'PICKUP', priceCents: 10000, durationMinutes: 115 },
      ],
    });

    const s2 = await prisma.service.create({
      data: {
        categoryId: catLavagem.id,
        name: 'Lavagem Completa & Cera',
        description: 'Lavagem técnica detalhada, limpeza de rodas, aspiração profunda, cera de carnaúba e pretinho.',
        basePriceCents: 8500, // R$ 85,00
        baseDurationMinutes: 75,
        isActive: true,
      },
    });

    await prisma.servicePriceRule.createMany({
      data: [
        { serviceId: s2.id, sizeCategory: 'SMALL', priceCents: 7500, durationMinutes: 60 },
        { serviceId: s2.id, sizeCategory: 'MEDIUM', priceCents: 8500, durationMinutes: 75 },
        { serviceId: s2.id, sizeCategory: 'SUV', priceCents: 10500, durationMinutes: 90 },
        { serviceId: s2.id, sizeCategory: 'PICKUP', priceCents: 12500, durationMinutes: 100 },
      ],
    });
  }

  // Serviços de preço único (sem variação por porte)
  let catEstetica = await prisma.serviceCategory.findFirst({ where: { name: 'Estética e Proteção' } });
  if (!catEstetica) {
    catEstetica = await prisma.serviceCategory.create({
      data: {
        name: 'Estética e Proteção',
        description: 'Proteção da pintura e higienização',
        icon: 'sparkles',
        displayOrder: 2,
      },
    });

    await prisma.service.createMany({
      data: [
        {
          categoryId: catEstetica.id,
          name: 'Cera Carnaúba Express',
          description: 'Aplicação de cera de carnaúba para proteção e brilho da pintura.',
          basePriceCents: 2000,
          baseDurationMinutes: 15,
          displayOrder: 1,
        },
        {
          categoryId: catEstetica.id,
          name: 'Oxi-Sanitização com Ozônio',
          description: 'Higienização interna com ozônio para eliminar fungos, ácaros e odores.',
          basePriceCents: 8000,
          baseDurationMinutes: 30,
          displayOrder: 2,
        },
      ],
    });
  }
  console.log('✓ Catálogo de serviços sincronizado');

  // 5. Documentos Legais Iniciais (LGPD)
  // Texto base para revisão jurídica antes da publicação (incluir razão social e CNPJ)
  const legalDocs = [
    {
      slug: 'terms_of_use',
      version: '1.1',
      title: 'Termos de Uso',
      contentMarkdown: `Estes Termos de Uso regem o uso do aplicativo e do site do **Studio 85**, estética automotiva em Porto Alegre/RS, para consulta de serviços, agendamento e acompanhamento do atendimento. Ao criar uma conta, você declara que leu e concorda com estes termos e com a Política de Privacidade.

## 1. Cadastro e conta

- Para agendar pelo app é necessário criar uma conta com nome, e-mail, celular e CPF verdadeiros e atualizados.
- O cadastro é pessoal. Você é responsável por manter sua senha em sigilo e por tudo o que for feito com a sua conta.
- O e-mail é confirmado por um código de verificação antes do primeiro acesso.
- Podemos suspender contas com dados falsos, uso indevido ou tentativas de fraude.

## 2. Agendamentos

- O agendamento só é confirmado depois que o app exibe o código da reserva.
- Os horários disponíveis dependem da capacidade de atendimento de cada turno e podem mudar até a confirmação.
- Chegue com pelo menos 15 minutos de antecedência do horário marcado, para a equipe receber e vistoriar o veículo. Em caso de atraso, o atendimento pode ser remarcado de acordo com a disponibilidade do dia.
- Também é possível agendar pelo WhatsApp. Nesse caso, a confirmação é feita pela nossa equipe.

## 3. Valores e pagamento

- O valor de cada serviço depende do porte do veículo e é o exibido no momento do agendamento.
- O pagamento é feito no local, na retirada do veículo, salvo quando outra forma for informada no app.
- Serviços adicionais só são realizados com a sua autorização e cobrados à parte.

## 4. Cancelamento e não comparecimento

- Você pode cancelar pelo app enquanto o atendimento não tiver começado. O horário volta a ficar disponível para outros clientes.
- Se não for possível cancelar pelo app, fale com a gente pelo WhatsApp.
- Agendamentos sem comparecimento podem ser registrados como "não compareceu".

## 5. Recebimento e entrega do veículo

- Na chegada, a equipe confere o estado do veículo e registra avarias já existentes.
- Retire objetos de valor do veículo antes do atendimento.
- Avise na reserva ou na chegada sobre cuidados especiais, como adesivos, películas ou pinturas sensíveis.
- Quando o serviço terminar, o app mostra que o carro está pronto para retirada.

## 6. Telebusca (leva e traz)

Quando disponível, a Telebusca permite que a equipe busque e entregue o veículo no endereço informado, mediante a taxa exibida no agendamento. É necessário que alguém esteja no local para entregar e receber o veículo.

## 7. Alterações destes termos

Estes termos podem ser atualizados. Quando houver mudança relevante, avisaremos pelo app e, se necessário, pediremos um novo aceite.

## 8. Contato e foro

Dúvidas sobre estes termos podem ser enviadas pelo WhatsApp do Studio 85. Fica eleito o foro da comarca de Porto Alegre/RS, respeitados os direitos do consumidor.`,
    },
    {
      slug: 'privacy_policy',
      version: '1.1',
      title: 'Política de Privacidade',
      contentMarkdown: `Esta Política explica como o **Studio 85** trata os seus dados pessoais, de acordo com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).

## 1. Dados que coletamos

- **Cadastro:** nome, e-mail, celular e CPF.
- **Veículos:** marca, modelo, placa, cor, ano e porte.
- **Endereços:** somente quando você usa a Telebusca.
- **Agendamentos:** serviços, datas, horários, valores e observações que você informar.
- **Acesso:** endereço IP, navegador e data do aceite dos termos, para segurança e comprovação.

## 2. Para que usamos os dados

- Criar e proteger a sua conta.
- Agendar, realizar e acompanhar os serviços.
- Avisar sobre o agendamento e quando o carro estiver pronto, por e-mail ou WhatsApp.
- Emitir comprovantes e cumprir obrigações legais e fiscais.
- Prevenir fraudes e uso indevido do app.

As bases legais são a execução do contrato de prestação de serviço, o cumprimento de obrigação legal e o legítimo interesse em manter o app seguro.

## 3. Compartilhamento

Não vendemos os seus dados. Eles podem ser tratados por fornecedores que nos ajudam a operar o app, como hospedagem e envio de mensagens, sempre com obrigação de sigilo. Também podemos compartilhá-los com autoridades quando a lei exigir.

## 4. Segurança

- O CPF é armazenado criptografado.
- A senha é guardada apenas como código irreversível (hash) e nunca fica visível para a equipe.
- O acesso aos dados é restrito a quem precisa deles para atender você.

## 5. Por quanto tempo guardamos

Mantemos os dados enquanto a sua conta estiver ativa e, depois disso, pelo tempo exigido por lei, por exemplo para fins fiscais. Dados que não forem mais necessários são excluídos ou anonimizados.

## 6. Seus direitos

Você pode pedir a qualquer momento: confirmação de que tratamos seus dados, acesso, correção, anonimização ou exclusão, portabilidade, informação sobre compartilhamento e revogação do consentimento, quando for o caso. Basta falar com a gente pelo WhatsApp do Studio 85.

## 7. Cookies e armazenamento no navegador

Usamos um cookie de sessão, necessário para manter você conectado com segurança, e guardamos no navegador a sua preferência de tema claro ou escuro. Para melhorar o app, contamos de forma anônima quantas pessoas abrem o site e o agendamento: o navegador gera um código aleatório que vale só enquanto a aba está aberta e não identifica você. Não usamos cookies de publicidade.

## 8. Alterações

Esta Política pode ser atualizada. A versão vigente fica sempre disponível no app.`,
    },
    {
      slug: 'cancellation_policy',
      version: '1.0',
      title: 'Política de Cancelamento',
      contentMarkdown: `## Pagamento no local

Enquanto o pagamento for feito na retirada do veículo, você pode cancelar pelo app sem custo até o atendimento começar.

## Pagamentos antecipados

Quando houver pagamento online:

- Cancelamento com **4 horas ou mais** de antecedência: reembolso de 100% do valor pago.
- Cancelamento com **menos de 4 horas**: reembolso de 50% do valor pago.
- Descontos e cupons não são convertidos em dinheiro.
- Falhas do estabelecimento e o direito de arrependimento previsto no Código de Defesa do Consumidor são analisados caso a caso.`,
    },
  ];

  for (const doc of legalDocs) {
    await prisma.legalDocument.upsert({
      where: { slug: doc.slug },
      update: { title: doc.title, version: doc.version, contentMarkdown: doc.contentMarkdown },
      create: doc,
    });
  }
  console.log('✓ Documentos legais (LGPD) sincronizados');

  // 5.1 Mensagens automáticas de WhatsApp (editáveis em Configurações)
  const messageTemplates = [
    {
      key: 'APPOINTMENT_CONFIRMED',
      title: 'Agendamento confirmado',
      body: [
        'Olá, {primeiro_nome}! Seu horário no {empresa} está confirmado para {data} às {hora}.',
        '{aviso_chegada}',
        '',
        'Serviços: {servicos}',
        'Veículo: {veiculo} ({placa})',
        'Valor: {total}',
        'Código: {codigo}',
        '',
        'Endereço: {endereco}',
      ].join('\n'),
      isActive: true,
      attachPhotos: false,
    },
    {
      key: 'CAR_READY',
      title: 'Carro pronto para retirada',
      body: [
        'Olá, {primeiro_nome}! Seu {veiculo} ({placa}) está pronto para retirada no {empresa}.',
        '',
        'Valor: {total}',
        'Endereço: {endereco}',
        '',
        'Obrigado pela preferência!',
      ].join('\n'),
      isActive: true,
      attachPhotos: true,
    },
    {
      key: 'APPOINTMENT_CANCELLED',
      title: 'Agendamento desmarcado',
      body: [
        'Olá, {primeiro_nome}! Seu horário no {empresa} de {data} às {hora} ({servicos}) foi desmarcado.',
        '',
        'Para marcar outro horário, é só responder esta mensagem ou agendar pelo app.',
      ].join('\n'),
      isActive: true,
      attachPhotos: false,
    },
  ];
  for (const template of messageTemplates) {
    await prisma.messageTemplate.upsert({
      where: { key: template.key },
      update: {},
      create: template,
    });
  }
  console.log('✓ Mensagens automáticas de WhatsApp sincronizadas');

  // 6. Usuários do Sistema
  // Contas de teste com senha simples SÓ fora de produção. Em produção o admin vem de
  // SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (senha forte) e nenhuma conta de teste é criada.
  const isProduction = process.env.NODE_ENV === 'production';
  const usersToSeed: { name: string; email: string; password: string; role: string; phone: string; cpf: string }[] = [];

  if (isProduction) {
    const email = process.env.SEED_ADMIN_EMAIL || 'contato@studio85poa.com.br';
    const password = process.env.SEED_ADMIN_PASSWORD || '12345678';
    if (email && password.length >= 8) {
      usersToSeed.push({
        name: process.env.SEED_ADMIN_NAME || 'Studio 85 Admin',
        email,
        password,
        role: 'ADMIN',
        phone: process.env.SEED_ADMIN_PHONE || '5192198686',
        cpf: process.env.SEED_ADMIN_CPF || '',
      });
    } else {
      console.log('! Produção: defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD (8+ caracteres) para criar o admin.');
    }
  } else {
    usersToSeed.push(
      {
        name: 'Studio 85 Admin',
        email: 'contato@studio85poa.com.br',
        password: '12345678',
        role: 'ADMIN',
        phone: '5192198686',
        cpf: '',
      },
      {
        name: 'Idelcio Forest',
        email: 'idelcioforest@gmail.com',
        password: '12345678',
        role: 'CLIENT',
        phone: '51999999999',
        cpf: '11111111111',
      },
      {
        name: 'Ide (Cliente Teste)',
        email: 'ide@gmail.com',
        password: '12345678',
        role: 'CLIENT',
        phone: '51988888888',
        cpf: '22222222222',
      },
    );
  }

  for (const u of usersToSeed) {
    const passwordHash = await argon2.hash(u.password, {
      algorithm: argon2.Algorithm.Argon2id,
      memoryCost: 65536,
      timeCost: 3,
    });

    const roleRecord = await prisma.role.findUnique({ where: { name: u.role } });
    if (!roleRecord) continue;

    const existingUser = await prisma.user.findUnique({ where: { email: u.email } });

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      console.log(`✓ Usuário atualizado: ${u.email} (Role: ${u.role})`);
    } else {
      await prisma.user.create({
        data: {
          name: u.name,
          email: u.email,
          phone: u.phone || null,
          cpfEncrypted: u.cpf ? encryptCPF(u.cpf) : null,
          cpfLookupHash: u.cpf ? hashCPF(u.cpf) : null,
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          roles: {
            create: {
              roleId: roleRecord.id,
            },
          },
        },
      });
      console.log(
        isProduction
          ? `✓ Usuário criado: ${u.email} (Role: ${u.role})`
          : `✓ Usuário criado: ${u.email} (Senha: ${u.password} | Role: ${u.role})`,
      );
    }
  }

  // 7. Veículo de teste na garagem do cliente
  const testClient = await prisma.user.findUnique({ where: { email: 'ide@gmail.com' } });
  if (testClient) {
    const hasVehicle = await prisma.vehicle.findFirst({ where: { userId: testClient.id } });
    if (!hasVehicle) {
      await prisma.vehicle.create({
        data: {
          userId: testClient.id,
          plate: 'HND2B34',
          internalCode: 'VH-5EED01',
          make: 'Honda',
          model: 'Civic',
          year: 2022,
          color: 'Preto',
          sizeCategory: 'MEDIUM',
        },
      });
      console.log('✓ Veículo de teste cadastrado para ide@gmail.com');
    }
  }

  console.log('Seed concluído com êxito!');
}

main()
  .catch((e) => {
    console.error('Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
