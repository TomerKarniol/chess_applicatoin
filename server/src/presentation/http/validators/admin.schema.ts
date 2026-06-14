import { z } from 'zod';
import { USERNAME_MAX, USERNAME_MIN } from '../../../domain/user.js';

export const createStudentBodySchema = z.object({
  username: z.string().trim().min(USERNAME_MIN).max(USERNAME_MAX),
});
export type CreateStudentBody = z.infer<typeof createStudentBodySchema>;

export const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type UserIdParam = z.infer<typeof userIdParamSchema>;
