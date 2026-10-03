import path from 'node:path';
import { z } from 'zod';

/**
 * Runtime configuration, read from environment variables (see `.env.example`).
 * `--demo` switches to the local-folder Drive simulation with its own database,
 * so the evaluators can run the product without Google credentials.
 */

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  DATA_DIR: z.string().default('data'),
  DRIVE_MODE: z.enum(['google', 'local']).default('local'),
  LOCAL_DRIVE_DIR: z.string().default('demo-drive'),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,
  DRIVE_TEST_FOLDER_ID: optionalString,
  APP_SECRET: optionalString,
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(600).default(120),
  AI_PROVIDER: z.enum(['auto', 'claude', 'heuristic']).default('auto'),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_API_KEY: optionalString,
  REGISTRY_FILE_NAME: optionalString,
});

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  folderId: string;
}

export interface AppConfig {
  port: number;
  host: string;
  databaseFile: string;
  driveMode: 'google' | 'local';
  localDriveDir: string;
  google: GoogleConfig | null;
  appSecret: string | null;
  syncIntervalSeconds: number;
  /** `apiKey` is only handed to the Anthropic client; it is never logged or sent to the browser. */
  ai: { provider: 'claude' | 'heuristic'; model: string; reason: string; apiKey: string | null };
  registryFileNameFallback: string | null;
  webDistDir: string;
  membersFile: string;
  demo: boolean;
}

const GOOGLE_REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'DRIVE_TEST_FOLDER_ID', 'APP_SECRET'] as const;
const MIN_SECRET_LENGTH = 32;

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv, argv: string[], rootDir: string): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new ConfigError(`Configuração inválida: ${issues}`);
  }
  const vars = parsed.data;
  const demo = argv.includes('--demo');
  const driveMode = demo ? 'local' : vars.DRIVE_MODE;
  const dataDir = path.resolve(rootDir, demo ? path.join(vars.DATA_DIR, 'demo') : vars.DATA_DIR);

  return {
    port: vars.PORT,
    host: vars.HOST,
    databaseFile: path.join(dataDir, driveMode === 'google' ? 'central-google.sqlite' : 'central-local.sqlite'),
    driveMode,
    localDriveDir: path.resolve(rootDir, vars.LOCAL_DRIVE_DIR),
    google: driveMode === 'google' ? readGoogleConfig(vars) : null,
    appSecret: vars.APP_SECRET ?? null,
    syncIntervalSeconds: vars.SYNC_INTERVAL_SECONDS,
    ai: resolveAiProvider(vars.AI_PROVIDER, vars.AI_MODEL, vars.ANTHROPIC_API_KEY ?? null),
    registryFileNameFallback: vars.REGISTRY_FILE_NAME ?? null,
    webDistDir: path.resolve(rootDir, 'dist/web'),
    membersFile: path.resolve(rootDir, 'config/members.json'),
    demo,
  };
}

function readGoogleConfig(vars: z.infer<typeof envSchema>): GoogleConfig {
  const missing = GOOGLE_REQUIRED.filter((key) => !vars[key]);
  if (missing.length > 0) {
    throw new ConfigError(`DRIVE_MODE=google exige as variáveis: ${missing.join(', ')}. Veja o README.`);
  }
  if ((vars.APP_SECRET ?? '').length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`APP_SECRET precisa ter pelo menos ${MIN_SECRET_LENGTH} caracteres.`);
  }
  return {
    clientId: vars.GOOGLE_CLIENT_ID as string,
    clientSecret: vars.GOOGLE_CLIENT_SECRET as string,
    redirectUri: vars.GOOGLE_REDIRECT_URI as string,
    folderId: vars.DRIVE_TEST_FOLDER_ID as string,
  };
}

function resolveAiProvider(
  requested: 'auto' | 'claude' | 'heuristic',
  model: string,
  apiKey: string | null,
): AppConfig['ai'] {
  if (requested === 'heuristic') {
    return { provider: 'heuristic', model, apiKey: null, reason: 'AI_PROVIDER=heuristic: extração determinística por regras.' };
  }
  if (!apiKey) {
    const reason = 'ANTHROPIC_API_KEY ausente: usando extração determinística por regras.';
    if (requested === 'claude') throw new ConfigError(`AI_PROVIDER=claude exige ANTHROPIC_API_KEY. ${reason}`);
    return { provider: 'heuristic', model, apiKey: null, reason };
  }
  return { provider: 'claude', model, apiKey, reason: `Claude (${model}) com validação determinística das sugestões.` };
}
