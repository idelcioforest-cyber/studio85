import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { SensitiveDataMaskingInterceptor } from './common/interceptors/sensitive-data-masking.interceptor';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { ServicesModule } from './modules/services/services.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { LegalModule } from './modules/legal/legal.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { MailModule } from './modules/mail/mail.module';
import { SeoModule } from './modules/seo/seo.module';
import { PagarmeModule } from './modules/pagarme/pagarme.module';
import { RevenueModule } from './modules/revenue/revenue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../infra/.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL) || 60000,
        limit: Number(process.env.THROTTLE_LIMIT) || 100,
      },
    ]),
    PrismaModule,
    MailModule,
    SeoModule,
    AuthModule,
    HealthModule,
    VehiclesModule,
    AddressesModule,
    ServicesModule,
    SettingsModule,
    ScheduleModule,
    AppointmentsModule,
    LegalModule,
    WhatsAppModule,
    PagarmeModule,
    RevenueModule,
  ],
  providers: [
    // Rate Limiting global (ForestSecurity Seção 6)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Autenticação JWT global (rotas públicas marcadas com @Public())
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // RBAC global com negação por padrão (ForestSecurity Seção 2)
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Mascaramento de dados confidenciais (senhas, CPF, cartões)
    {
      provide: APP_INTERCEPTOR,
      useClass: SensitiveDataMaskingInterceptor,
    },
    // Auditoria de mutações administrativas
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    // Tratamento e sanitização global de exceções
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
