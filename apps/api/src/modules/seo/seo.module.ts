import { Module } from '@nestjs/common';
import { SeoService } from './seo.service';

@Module({
  providers: [SeoService],
  exports: [SeoService],
})
export class SeoModule {}
