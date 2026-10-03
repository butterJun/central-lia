import fs from 'node:fs';
import path from 'node:path';
import { ConfigError, loadConfig } from './config.ts';
import { createContainer } from './container.ts';
import { buildApp } from './http/app.ts';
import type { Logger } from './sync/sync-service.ts';

/** Entry point: `npm start` (configured Drive) or `npm run demo` (local folder simulation). */

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

const consoleLogger: Logger = {
  info: (message) => console.log(`[${new Date().toISOString()}] ${message}`),
  warn: (message) => console.warn(`[${new Date().toISOString()}] AVISO ${message}`),
  error: (message) => console.error(`[${new Date().toISOString()}] ERRO ${message}`),
};

async function main(): Promise<void> {
  const envFile = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const config = loadConfig(process.env, process.argv, ROOT_DIR);
  const container = createContainer(config, { logger: consoleLogger });
  const app = await buildApp(container);
  await app.listen({ port: config.port, host: config.host });
  container.scheduler.start();

  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  consoleLogger.info(`Central LIA em ${url}`);
  consoleLogger.info(
    config.driveMode === 'google'
      ? `Drive: Google (pasta ${config.google?.folderId}). ${container.auth?.isConnected() ? 'Conectado.' : `Conecte em ${url}/sincronizacao`}`
      : `Drive: pasta local ${config.localDriveDir} (simulação para demonstração)`,
  );
  consoleLogger.info(`IA: ${config.ai.reason} Sincronização automática a cada ${config.syncIntervalSeconds}s.`);
  if (!fs.existsSync(config.webDistDir)) consoleLogger.warn('Interface não compilada: rode "npm run build" ou use "npm run dev".');

  const shutdown = async () => {
    consoleLogger.info('Encerrando...');
    container.scheduler.stop();
    await app.close();
    container.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(`\n${error.message}\n`);
  else console.error(error);
  process.exit(1);
});
