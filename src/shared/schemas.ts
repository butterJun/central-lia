import { z } from 'zod';
import { ACTIVITY_STATUSES } from './domain.ts';
import { isIsoDate } from './dates.ts';

/** Validation schemas for API inputs. Shared so the web forms use the same rules. */

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine(isIsoDate, 'Data inexistente no calendário');

export const activityFieldsSchema = z.object({
  title: z.string().trim().min(3, 'Informe um título com pelo menos 3 caracteres').max(160, 'Título muito longo'),
  description: z.string().trim().max(2000, 'Descrição muito longa'),
  nextStep: z.string().trim().max(500, 'Próximo passo muito longo'),
  ownerIds: z.array(z.string().min(1)).max(10, 'No máximo 10 responsáveis'),
  front: z.string().trim().min(1, 'Informe a frente').max(60, 'Nome de frente muito longo'),
  status: z.enum(ACTIVITY_STATUSES),
  dueDate: isoDateSchema.nullable(),
});

export const createActivitySchema = activityFieldsSchema.extend({
  description: activityFieldsSchema.shape.description.default(''),
  nextStep: activityFieldsSchema.shape.nextStep.default(''),
  ownerIds: activityFieldsSchema.shape.ownerIds.default([]),
  dueDate: activityFieldsSchema.shape.dueDate.default(null),
});
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = activityFieldsSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(300).optional(),
});
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export const reviewSuggestionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('accept'), force: z.boolean().optional() }),
  z.object({
    decision: z.literal('adjust'),
    fields: activityFieldsSchema.partial(),
    note: z.string().trim().max(500).optional(),
    force: z.boolean().optional(),
  }),
  z.object({
    decision: z.literal('reject'),
    note: z.string().trim().min(3, 'Explique o motivo da rejeição').max(500),
  }),
]);
export type ReviewSuggestionInput = z.infer<typeof reviewSuggestionSchema>;

export const resolveConflictSchema = z.object({
  resolution: z.string().trim().min(3, 'Descreva a decisão tomada').max(500),
});

export const DIGEST_PERIODS = ['last_visit', '7d', '30d', 'all'] as const;
export const digestQuerySchema = z.object({
  period: z.enum(DIGEST_PERIODS).default('last_visit'),
});
export type DigestPeriod = (typeof DIGEST_PERIODS)[number];
