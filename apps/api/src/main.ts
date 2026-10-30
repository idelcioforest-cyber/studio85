import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { SeoService } from './modules/seo/seo.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const isProduction = process.env.NODE_ENV === 'production';

  // Atrás do proxy da hospedagem: o IP real do cliente vem no X-Forwarded-For (limite de tentativas por IP)
  if (process.env.TRUST_PROXY !== 'false' && isProduction) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  }

  // Um endereço só para o Google: www.dominio → dominio (o de FRONTEND_URL), com 301
  const canonicalOrigin = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  if (isProduction && /^https?:\/\//.test(canonicalOrigin)) {
    const canonicalHost = new URL(canonicalOrigin).hostname;
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.hostname === `www.${canonicalHost}`) return res.redirect(301, `${canonicalOrigin}${req.originalUrl}`);
      next();
    });
  }

  // 1. Headers de segurança HTTP via Helmet (ForestSecurity Seção 9)
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
              imgSrc: ["'self'", 'data:', 'blob:'],
              // Pagar.me: o navegador gera o token do cartão direto na API deles (o número nunca passa por aqui)
              connectSrc: ["'self'", 'https://api.pagar.me'],
              workerSrc: ["'self'"],
              manifestSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
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
  // O webhook do Pagar.me fica em /api/webhook/pagarme (endereço já cadastrado no painel deles)
  app.setGlobalPrefix(apiPrefix.replace(/^\//, ''), {
    exclude: [{ path: 'api/webhook/pagarme', method: RequestMethod.POST }],
  });

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

  // Em produção a documentação fica desligada, a menos que SWAGGER_ENABLED=true
  const swaggerEnabled = !isProduction || process.env.SWAGGER_ENABLED === 'true';
  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // 6. Site (build do apps/web) servido pelo mesmo processo: um único app Node na hospedagem
  const webDist = path.resolve(process.env.WEB_DIST_PATH || path.join(__dirname, '../../web/dist'));
  const webIndex = path.join(webDist, 'index.html');
  const serveWeb = existsSync(webIndex);
  if (serveWeb) {
    const seo = app.get(SeoService);
    const indexTemplate = readFileSync(webIndex, 'utf8');

    // robots.txt e sitemap.xml gerados com o domínio de FRONTEND_URL
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path === '/robots.txt') return res.type('text/plain').send(seo.robotsTxt());
      if (req.path === '/sitemap.xml') return res.type('application/xml').send(seo.sitemapXml());
      next();
    });

    app.useStaticAssets(webDist, {
      index: false,
      setHeaders: (res, filePath) => {
        // Arquivos com hash no nome nunca mudam; o resto (index, sw.js, manifest) é revalidado
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Rotas do React (/agenda, /admin/patio...) devolvem o index.html já com título, descrição e dados
    // da empresa daquela página (o Google lê sem rodar o JavaScript); /api e arquivos inexistentes vão para o 404
    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || /^\/api(\/|$)/.test(req.path) || path.extname(req.path)) {
        return next();
      }
      try {
        const html = await seo.renderIndex(indexTemplate, req.path);
        res.setHeader('Cache-Control', 'no-cache');
        res.type('html').send(html);
      } catch (error) {
        next(error);
      }
    });
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`=======================================================`);
  logger.log(`🚗 Studio 85 API iniciada com sucesso na porta: ${port}`);
  logger.log(`🌐 Prefixo da API: ${apiPrefix}`);
  if (swaggerEnabled) logger.log(`📖 Documentação Swagger: http://localhost:${port}/api/docs`);
  logger.log(serveWeb ? `🖥️  Site servido a partir de ${webDist}` : '🖥️  Build do site não encontrado: servindo só a API');
  logger.log(`🛡️  Políticas ForestSecurity: Ativas e em conformidade`);
  logger.log(`=======================================================`);
}

bootstrap();
