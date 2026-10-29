import { Module } from '@nestjs/common';
import { LegalService } from './legal.service';
import { LegalController } from './legal.controller';

@Module({
  controllers: [LegalController],
  providers: [LegalService],
})
export class LegalModule {}
