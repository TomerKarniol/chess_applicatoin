import { z } from 'zod';
import { NEW_PASSWORD_MAX, NEW_PASSWORD_MIN } from '../../../domain/user.js';

export const forgotBodySchema = z.object({
  identifier: z.string().trim().min(1).max(254),
});
export type ForgotBody = z.infer<typeof forgotBodySchema>;

export const verifyBodySchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Code must be digits only'),
});
export type VerifyBody = z.infer<typeof verifyBodySchema>;

export const resetBodySchema = z.object({
  newPassword: z.string().min(NEW_PASSWORD_MIN).max(NEW_PASSWORD_MAX),
  confirmPassword: z.string().min(NEW_PASSWORD_MIN).max(NEW_PASSWORD_MAX),
});
export type ResetBody = z.infer<typeof resetBodySchema>;
