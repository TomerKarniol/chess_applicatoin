import { z } from 'zod';
import { NEW_PASSWORD_MAX, NEW_PASSWORD_MIN } from '../../../domain/user.js';

export const setupBodySchema = z.object({
  email: z.string().trim().min(3).max(254),
  newPassword: z.string().min(NEW_PASSWORD_MIN).max(NEW_PASSWORD_MAX),
  confirmPassword: z.string().min(NEW_PASSWORD_MIN).max(NEW_PASSWORD_MAX),
});

export type SetupBody = z.infer<typeof setupBodySchema>;
