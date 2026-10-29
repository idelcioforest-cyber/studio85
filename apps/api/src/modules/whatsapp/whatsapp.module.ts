import { Module } from '@nestjs/common';
import { WhatsAppBridgeService } from './whatsapp-bridge.service';
import { NotificationsService } from './notifications.service';
import { WhatsAppController } from './whatsapp.controller';

@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppBridgeService, NotificationsService],
  exports: [NotificationsService],
})
export class WhatsAppModule {}
