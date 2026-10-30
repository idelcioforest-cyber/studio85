import { z } from 'zod';

// Importado antes de qualquer schema (ver index.ts): a configuração vale desde a criação deles.
// Mensagens padrão do zod em português (as mensagens próprias dos schemas continuam valendo)
z.config(z.locales.pt());
// Sem compilação via new Function: a CSP do site bloqueia eval
z.config({ jitless: true });
