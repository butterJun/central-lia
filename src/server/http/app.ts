import fs from 'node:fs';
import path from 'node:path';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import type { Member } from '../../shared/domain.ts';
import type { Container } from '../container.ts';
import { AppError, ForbiddenError, UnauthenticatedError, ValidationError } from '../lib/errors.ts';
import { registerActivityRoutes } from './activity-routes.ts';
import { registerContextRoutes } from './context-routes.ts';
import { registerSuggestionRoutes } from './suggestion-routes.ts';
import { registerSyncRoutes } from './sync-routes.ts';

/** Header carrying the demo profile chosen in the UI. Not authentication: see README "Antes de usar dados reais". */
export const DEMO_USER_HEADER = 'x-demo-user';

export function currentMember(container: Container, request: FastifyRequest): Member {
  const raw = request.headers[DEMO_USER_HEADER];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new UnauthenticatedError('Escolha um perfil de demonstração no topo da página.');
  const member = container.repos.members.get(id);
  if (!member) throw new UnauthenticatedError(`Perfil de demonstração desconhecido: ${id}`);
  return member;
}

export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new ValidationError(message, parsed.error.issues);
  }
  return parsed.data;
}

export async function buildApp(container: Container): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  });

  app.setErrorHandler((error, _request, reply) => sendError(container, error, reply));
  app.addHook('onRequest', async (request) => assertTrustedRequest(request, container.config.host));

  registerActivityRoutes(app, container);
  registerSuggestionRoutes(app, container);
  registerSyncRoutes(app, container);
  registerContextRoutes(app, container);
  app.get('/api/health', async () => ({ ok: true }));

  await serveWebApp(app, container.config.webDistDir);
  return app;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostnameOf(hostHeader: string): string {
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0] ?? '';
}

function isAllowedHostname(hostname: string, boundHost: string): boolean {
  if (boundHost === '0.0.0.0' || boundHost === '::') return true;
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase()) || hostname === boundHost;
}

/**
 * Protects the local server from other websites open in the same browser:
 * an unexpected Host header (DNS rebinding) or a cross-site Origin on a
 * state-changing request is refused.
 */
export function assertTrustedRequest(request: FastifyRequest, boundHost: string): void {
  if (!isAllowedHostname(hostnameOf(request.headers.host ?? ''), boundHost)) {
    throw new ForbiddenError('Host não permitido para esta aplicação local.');
  }
  const origin = request.headers.origin;
  if (SAFE_METHODS.has(request.method) || !origin) return;
  let originHost = '';
  try {
    originHost = new URL(origin).hostname;
  } catch {
    throw new ForbiddenError('Origem da requisição inválida.');
  }
  if (!isAllowedHostname(originHost.includes(':') ? `[${originHost}]` : originHost, boundHost)) {
    throw new ForbiddenError('Requisição de outro site recusada.');
  }
}

function sendError(container: Container, error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details ?? null } });
  }
  if (error instanceof ZodError) {
    return reply.status(400).send({ error: { code: 'validation_error', message: 'Dados inválidos', details: error.issues } });
  }
  const statusCode = (error as { statusCode?: number }).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return reply.status(statusCode).send({ error: { code: 'bad_request', message: (error as Error).message, details: null } });
  }
  container.logger.error(`Erro inesperado: ${(error as Error).stack ?? String(error)}`);
  return reply.status(500).send({ error: { code: 'internal', message: 'Erro interno. Tente de novo; se persistir, veja os logs do servidor.', details: null } });
}

/** Serves the built React app, falling back to index.html for client-side routes. */
async function serveWebApp(app: FastifyInstance, webDistDir: string): Promise<void> {
  const indexFile = path.join(webDistDir, 'index.html');
  const hasBuild = fs.existsSync(indexFile);
  if (hasBuild) await app.register(fastifyStatic, { root: webDistDir });
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '';
    const isFileRequest = /\.[a-z0-9]+$/i.test(pathname);
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/') || isFileRequest || !hasBuild || request.method !== 'GET') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada', details: null } });
    }
    return reply.type('text/html; charset=utf-8').send(fs.readFileSync(indexFile));
  });
}
