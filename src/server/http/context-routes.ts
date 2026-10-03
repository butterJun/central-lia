import type { FastifyInstance } from 'fastify';
import { digestQuerySchema } from '../../shared/schemas.ts';
import type { Container } from '../container.ts';
import { currentMember, parseWith } from './app.ts';

export function registerContextRoutes(app: FastifyInstance, container: Container): void {
  const { digestService, narrator, onboardingService } = container;

  app.get('/api/digest', async (request) => {
    const member = currentMember(container, request);
    const { period } = parseWith(digestQuerySchema, request.query);
    return digestService.build(member.id, period);
  });

  /** Prose version of the digest, written from the structured digest only. */
  app.post('/api/digest/narrative', async (request) => {
    const member = currentMember(container, request);
    const { period } = parseWith(digestQuerySchema, request.query);
    return narrator.narrate(digestService.build(member.id, period), member.displayName);
  });

  app.get('/api/onboarding', async (request) => {
    const member = currentMember(container, request);
    return onboardingService.build(member.id);
  });
}
