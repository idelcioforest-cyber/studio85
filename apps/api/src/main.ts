import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // 1. Headers de segurança HTTP via Helmet (ForestSecurity Seção 9)
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 2. Parser de Cookies (para autenticação segura via cookie HttpOnly)
  app.use(cookieParser());

  // 3. CORS com lista branca estrita (ForestSecurity Seção 9)
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim());

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origem CORS não autorizada: ${origin}`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Bridge-Token'],
  });

  // 4. Prefixo de rota da API versionada (/api/v1)
  const apiPrefix = process.env.API_PREFIX || '/api/v1';
  app.setGlobalPrefix(apiPrefix.replace(/^\//, ''));

  // 5. Documentação OpenAPI / Swagger (acesso controlado)
  const config = new DocumentBuilder()
    .setTitle('Studio 85 API')
    .setDescription(
      'Documentação técnica oficial dos contratos de API REST v1 para gestão de lava-rápido e estética automotiva.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addCookieAuth('autowash_access_token')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`=======================================================`);
  logger.log(`🚗 Studio 85 API iniciada com sucesso na porta: ${port}`);
  logger.log(`🌐 Prefixo da API: ${apiPrefix}`);
  logger.log(`📖 Documentação Swagger: http://localhost:${port}/api/docs`);
  logger.log(`🛡️  Políticas ForestSecurity: Ativas e em conformidade`);
  logger.log(`=======================================================`);
}

bootstrap();
