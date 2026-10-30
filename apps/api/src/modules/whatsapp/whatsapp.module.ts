import { Module } from '@nestjs/common';
import { WhatsAppBridgeService } from './whatsapp-bridge.service';
import { NotificationsService } from './notifications.service';
import { WhatsAppController } from './whatsapp.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppBridgeService, NotificationsService, CampaignsService],
  exports: [NotificationsService],
})
export class WhatsAppModule {}
