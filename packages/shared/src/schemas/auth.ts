import { z } from 'zod';
import { isValidCPF, cleanCPF } from '../utils/cpf';

/**
 * Schema de autocadastro do cliente
 */
export const RegisterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'O nome completo deve conter no mínimo 3 caracteres')
    .max(120, 'O nome deve conter no máximo 120 caracteres'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail em formato inválido')
    .max(150, 'E-mail muito longo'),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{9,14}$/, 'Telefone deve estar no formato DDD + número (ex: 11988887777 ou +5511988887777)'),
  cpf: z
    .string()
    .trim()
    .refine((val) => isValidCPF(val), {
      message: 'CPF inválido. Verifique os dígitos informados.',
    })
    .transform((val) => cleanCPF(val)),
  password: z
    .string()
    .min(8, 'A senha deve conter no mínimo 8 caracteres')
    .max(72, 'A senha deve conter no máximo 72 caracteres')
    .regex(/[A-Z]/, 'A senha deve conter ao menos uma letra maiúscula')
    .regex(/[a-z]/, 'A senha deve conter ao menos uma letra minúscula')
    .regex(/[0-9]/, 'A senha deve conter ao menos um número')
    .regex(/[^A-Za-z0-9]/, 'A senha deve conter ao menos um caractere especial'),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Você deve aceitar os Termos de Uso e Política de Privacidade' }),
  }),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Schema de login do usuário
 */
export const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail em formato inválido'),
  password: z
    .string()
    .min(1, 'A senha é obrigatória'),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Schema de verificação de e-mail por código de uso único
 */
export const VerifyEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail em formato inválido'),
  code: z
    .string()
    .trim()
    .length(6, 'O código de verificação deve conter exatamente 6 dígitos')
    .regex(/^\d+$/, 'O código de verificação deve conter apenas números'),
});

export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

/**
 * Schema para reenvio de código de verificação
 */
export const ResendCodeSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail em formato inválido'),
});

export type ResendCodeInput = z.infer<typeof ResendCodeSchema>;

/**
 * Schema de solicitação de recuperação de senha
 */
export const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail em formato inválido'),
});

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

/**
 * Schema de redefinição de senha com token
 */
export const ResetPasswordSchema = z.object({
  token: z
    .string()
    .min(10, 'Token de recuperação inválido'),
  newPassword: z
    .string()
    .min(8, 'A senha deve conter no mínimo 8 caracteres')
    .max(72, 'A senha deve conter no máximo 72 caracteres')
    .regex(/[A-Z]/, 'A senha deve conter ao menos uma letra maiúscula')
    .regex(/[a-z]/, 'A senha deve conter ao menos uma letra minúscula')
    .regex(/[0-9]/, 'A senha deve conter ao menos um número')
    .regex(/[^A-Za-z0-9]/, 'A senha deve conter ao menos um caractere especial'),
});

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/**
 * Primeiro acesso de cliente cadastrado pela equipe: troca a senha provisória e completa os dados
 */
export const CompleteProfileSchema = RegisterSchema.pick({
  name: true,
  phone: true,
  cpf: true,
  acceptTerms: true,
}).extend({
  newPassword: ResetPasswordSchema.shape.newPassword,
});

export type CompleteProfileInput = z.infer<typeof CompleteProfileSchema>;
