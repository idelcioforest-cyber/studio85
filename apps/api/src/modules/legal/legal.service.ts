import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const PUBLIC_SLUGS = ['terms_of_use', 'privacy_policy', 'cancellation_policy'];

@Injectable()
export class LegalService {
  constructor(private prisma: PrismaService) {}

  /**
   * Documento legal vigente (público, para leitura antes do cadastro)
   */
  async findActive(slug: string) {
    if (!PUBLIC_SLUGS.includes(slug)) {
      throw new NotFoundException('Documento não encontrado.');
    }

    const document = await this.prisma.legalDocument.findFirst({
      where: { slug, isActive: true },
      select: { slug: true, version: true, title: true, contentMarkdown: true, publishedAt: true },
    });
    if (!document) throw new NotFoundException('Documento não encontrado.');

    return document;
  }
}
