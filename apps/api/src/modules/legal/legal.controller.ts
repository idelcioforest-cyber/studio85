import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LegalService } from './legal.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Documentos Legais (LGPD)')
@Controller('legal')
export class LegalController {
  constructor(private legalService: LegalService) {}

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Termos de uso, política de privacidade ou de cancelamento vigentes' })
  async findActive(@Param('slug') slug: string) {
    return this.legalService.findActive(slug);
  }
}
