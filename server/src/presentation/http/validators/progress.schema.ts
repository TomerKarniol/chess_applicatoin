import { z } from 'zod';

const moduleIdSchema = z.string().min(1).max(64);

export const progressBodySchema = z.object({
  completed: z.array(moduleIdSchema).max(256),
  cards: z.array(moduleIdSchema).max(256),
  modules: z.record(z.string().min(1).max(64), z.unknown()),
  currentModule: z.union([moduleIdSchema, z.null()]),
});

export type ProgressBody = z.infer<typeof progressBodySchema>;
