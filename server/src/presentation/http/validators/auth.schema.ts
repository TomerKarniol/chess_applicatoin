import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from '../../../domain/user.js';

export const loginBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(USERNAME_MIN, 'username is required')
    .max(USERNAME_MAX, 'username is too long'),
  password: z
    .string()
    .min(PASSWORD_MIN, 'password is required')
    .max(PASSWORD_MAX, 'password is too long'),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
