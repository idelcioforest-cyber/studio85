import { z } from 'zod';
import { isValidCPF } from '../utils/cpf';
import { isValidCNPJ } from '../utils/cnpj';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const digits = (v: string) => v.replace(/\D/g, '');

const AddressSchema = {
  street: z.string().trim().min(2, 'Informe a rua').max(120),
  streetNumber: z.string().trim().min(1, 'Informe o número').max(20),
  complement: z.string().trim().max(80).optional(),
  neighborhood: z.string().trim().min(2, 'Informe o bairro').max(80),
  city: z.string().trim().min(2, 'Informe a cidade').max(80),
  state: z.string().trim().length(2, 'UF com 2 letras').transform((v) => v.toUpperCase()),
  zipCode: z
    .string()
    .transform(digits)
    .refine((v) => v.length === 8, 'CEP com 8 dígitos'),
};

/** Sócio administrador (obrigatório para PJ) */
export const RecipientPartnerSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome do sócio').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  cpf: z.string().transform(digits).refine(isValidCPF, 'CPF do sócio inválido'),
  birthdate: z.string().regex(DATE_REGEX, 'Informe a data de nascimento'),
  incomeCents: z.number().int().positive('Informe a renda mensal'),
  occupation: z.string().trim().min(2, 'Informe a profissão').max(80),
});

/**
 * Cadastro do recebedor do lava-jato no Pagar.me (PF ou PJ) com a conta bancária.
 * A conta precisa estar no mesmo CPF/CNPJ do recebedor (regra do Pagar.me).
 */
export const PaymentRecipientSchema = z
  .object({
    type: z.enum(['individual', 'corporation'], { error: 'Escolha pessoa física ou jurídica' }),
    name: z.string().trim().min(3, 'Informe o nome').max(120),
    tradingName: z.string().trim().max(120).optional(),
    email: z.string().trim().toLowerCase().email('E-mail inválido'),
    document: z.string().transform(digits),
    phone: z
      .string()
      .transform(digits)
      .refine((v) => v.length === 10 || v.length === 11, 'Telefone com DDD'),
    birthOrFoundingDate: z.string().regex(DATE_REGEX, 'Informe a data'),
    incomeCents: z.number().int().positive('Informe o valor'),
    professionalOccupation: z.string().trim().max(80).optional(),
    ...AddressSchema,
    partner: RecipientPartnerSchema.optional(),
    bankHolderName: z.string().trim().min(3, 'Informe o titular').max(120),
    bankCode: z.string().regex(/^\d{3}$/, 'Código do banco com 3 dígitos (ex.: 260)'),
    branchNumber: z.string().regex(/^\d{1,5}$/, 'Agência só com números'),
    branchCheckDigit: z.string().regex(/^[0-9xX]{0,2}$/, 'Dígito da agência inválido').optional(),
    accountNumber: z.string().regex(/^\d{1,13}$/, 'Conta só com números (até 13)'),
    accountCheckDigit: z.string().regex(/^[0-9xX]{1,2}$/, 'Informe o dígito da conta'),
    accountType: z.enum(['checking', 'savings'], { error: 'Escolha corrente ou poupança' }),
    feePercent: z.number().int().min(0).max(100).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'individual') {
      if (!isValidCPF(v.document)) ctx.addIssue({ code: 'custom', message: 'CPF inválido', path: ['document'] });
      if (!v.professionalOccupation) ctx.addIssue({ code: 'custom', message: 'Informe a profissão', path: ['professionalOccupation'] });
    } else {
      if (!isValidCNPJ(v.document)) ctx.addIssue({ code: 'custom', message: 'CNPJ inválido', path: ['document'] });
      if (!v.tradingName) ctx.addIssue({ code: 'custom', message: 'Informe o nome fantasia', path: ['tradingName'] });
      if (!v.partner) ctx.addIssue({ code: 'custom', message: 'Informe o sócio administrador', path: ['partner'] });
    }
  });

export type PaymentRecipientInput = z.infer<typeof PaymentRecipientSchema>;

/** Cartão: o número nunca passa pelo nosso servidor, só o token gerado no navegador */
export const CardPaymentSchema = z.object({
  cardToken: z.string().regex(/^token_[A-Za-z0-9]+$/, 'Cartão inválido. Digite os dados de novo.'),
  installments: z.number().int().min(1).max(12).default(1),
});

export type CardPaymentInput = z.infer<typeof CardPaymentSchema>;

/** Estorno total (sem valor) ou parcial (em centavos) */
export const RefundPaymentSchema = z.object({
  amountCents: z.number().int().positive('Valor inválido').optional(),
  reason: z.string().trim().max(200).optional(),
});

export type RefundPaymentInput = z.infer<typeof RefundPaymentSchema>;

export const PaymentsSummaryQuerySchema = z.object({
  from: z.string().regex(DATE_REGEX).optional(),
  to: z.string().regex(DATE_REGEX).optional(),
});

export type PaymentsSummaryQueryInput = z.infer<typeof PaymentsSummaryQuerySchema>;
