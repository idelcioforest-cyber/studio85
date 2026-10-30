import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodError, ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodType) {}

  transform(value: unknown) {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.issues.map((err) => ({
          field: err.path.map(String).join('.'),
          message: err.message,
        }));
        throw new BadRequestException({
          message: 'Dados de entrada inválidos',
          errors: formattedErrors,
        });
      }
      throw new BadRequestException('Erro de validação dos dados');
    }
  }
}
