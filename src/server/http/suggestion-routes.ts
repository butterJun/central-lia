import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUGGESTION_STATUSES } from '../../shared/domain.ts';
import { resolveConflictSchema, reviewSuggestionSchema } from '../../shared/schemas.ts';
import type { Container } from '../container.ts';
import { ForbiddenError } from '../lib/errors.ts';
import { currentMember, parseWith } from './app.ts';

const listQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',') : []))
    .pipe(z.array(z.enum(SUGGESTION_STATUSES))),
});
const suggestionParams = z.object({ id: z.string().min(1).max(40) });
const conflictParams = z.object({ id: z.coerce.number().int().positive() });

export function registerSuggestionRoutes(app: FastifyInstance, container: Container): void {
  const { suggestionService, reviewService, repos } = container;

  app.get('/api/suggestions', async (request) => {
    const { status } = parseWith(listQuery, request.query);
    return suggestionService.list(status);
  });

  app.get('/api/suggestions/:id', async (request) => {
    const { id } = parseWith(suggestionParams, request.params);
    return suggestionService.get(id);
  });

  app.post('/api/suggestions/:id/review', async (request) => {
    const member = currentMember(container, request);
    const { id } = parseWith(suggestionParams, request.params);
    const input = parseWith(reviewSuggestionSchema, request.body);
    return reviewService.review(id, input, member.id);
  });

  app.get('/api/conflicts', async () => repos.conflicts.list());

  app.post('/api/conflicts/:id/resolve', async (request) => {
    const member = currentMember(container, request);
    if (member.role !== 'reviewer') throw new ForbiddenError('Somente revisores podem encerrar conflitos.');
    const { id } = parseWith(conflictParams, request.params);
    const { resolution } = parseWith(resolveConflictSchema, request.body);
    return repos.conflicts.resolve(id, resolution, member.id);
  });
}
