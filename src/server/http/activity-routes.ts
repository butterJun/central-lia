import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createActivitySchema, updateActivitySchema } from '../../shared/schemas.ts';
import type { Container } from '../container.ts';
import { nowIso } from '../db/database.ts';
import { currentMember, parseWith } from './app.ts';

const idParams = z.object({ id: z.string().min(1).max(40) });

export function registerActivityRoutes(app: FastifyInstance, container: Container): void {
  const { activityService, repos } = container;

  app.get('/api/members', async () => repos.members.list());

  /** Marks a visit; the previous one is the start of "what changed since your last visit". */
  app.post('/api/session/visit', async (request) => {
    const member = currentMember(container, request);
    return repos.members.recordVisit(member.id, nowIso());
  });

  app.get('/api/activities', async () => activityService.list());

  app.get('/api/activities/:id', async (request) => {
    const { id } = parseWith(idParams, request.params);
    return activityService.detail(id);
  });

  app.post('/api/activities', async (request, reply) => {
    const member = currentMember(container, request);
    const input = parseWith(createActivitySchema, request.body);
    return reply.status(201).send(activityService.create(input, member.id));
  });

  app.patch('/api/activities/:id', async (request) => {
    const member = currentMember(container, request);
    const { id } = parseWith(idParams, request.params);
    const input = parseWith(updateActivitySchema, request.body);
    return activityService.update(id, input, member.id);
  });
}
