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

export const updateEmailBodySchema = z.object({
  email: z.string().trim().min(3).max(254),
});
export type UpdateEmailBody = z.infer<typeof updateEmailBodySchema>;

export const BULK_STUDENTS_MAX = 1000;

export const bulkStudentsBodySchema = z.object({
  students: z
    .array(
      z.object({
        firstName: z.string().trim().max(100).default(''),
        lastName: z.string().trim().max(100).default(''),
      }),
    )
    .min(1, 'CSV has no rows.')
    .max(BULK_STUDENTS_MAX, `At most ${BULK_STUDENTS_MAX} rows per upload.`),
});
export type BulkStudentsBody = z.infer<typeof bulkStudentsBodySchema>;
