import { Module } from '@nestjs/common';
import { PagarmeClient } from './pagarme.client';
import { PagarmeController } from './pagarme.controller';
import { PagarmePaymentsService } from './pagarme-payments.service';
import { PagarmeRecipientService } from './pagarme-recipient.service';
import { PagarmeSubscriptionsService } from './pagarme-subscriptions.service';
import { PagarmeWebhookService } from './pagarme-webhook.service';

@Module({
  controllers: [PagarmeController],
  providers: [PagarmeClient, PagarmeRecipientService, PagarmePaymentsService, PagarmeSubscriptionsService, PagarmeWebhookService],
  exports: [PagarmePaymentsService, PagarmeRecipientService, PagarmeSubscriptionsService],
})
export class PagarmeModule {}
