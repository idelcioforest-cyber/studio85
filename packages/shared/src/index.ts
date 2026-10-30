// Primeiro de tudo: configura o zod antes de qualquer schema ser criado
import './zod-config';

export * from './enums';
export * from './utils/cpf';
export * from './utils/plate';
export * from './schemas/auth';
export * from './schemas/vehicle';
export * from './schemas/address';
export * from './schemas/service';
export * from './schemas/settings';
export * from './schemas/appointment';
export * from './schemas/whatsapp';
