import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Stops the Central server if it is running (`npm run stop`).
 *
 * Finds the process listening on the configured port (PORT in `.env`, default 4000) and
 * terminates it only when its command line is this project's server. Any other program
 * on that port is left alone and reported.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_PORT = 4000;
const WAIT_MS = 5000;

/** PIDs in LISTENING state on exactly `port`, from Windows `netstat -ano -p tcp` output. */
export function listeningPidsFromNetstat(output: string, port: number): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[3] !== 'LISTENING') continue;
    if (!cols[1]?.endsWith(`:${port}`)) continue;
    const pid = Number(cols[4]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** True when the command line runs this project's `src/server/index.ts`. */
export function isCentralServer(commandLine: string, projectRoot: string): boolean {
  const norm = (text: string) => text.replaceAll('\\', '/').toLowerCase();
  const cmd = norm(commandLine);
  return cmd.includes('src/server/index.ts') && cmd.includes(norm(projectRoot));
}

/** Reads only the PORT entry from `.env` text (the rest of the file is ignored). */
export function portFromEnvFile(text: string | null): number {
  const match = text?.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
  const port = match ? Number(match[1]) : DEFAULT_PORT;
  return port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function listeningPids(port: number): number[] {
  if (process.platform === 'win32') return listeningPidsFromNetstat(run('netstat', ['-ano', '-p', 'tcp']), port);
  return run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    .split('\n')
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function commandLineOf(pid: number): string {
  if (process.platform === 'win32') {
    return run('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]).trim();
  }
  return run('ps', ['-o', 'command=', '-p', String(pid)]).trim();
}

async function waitUntilFree(port: number): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (listeningPids(port).length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return listeningPids(port).length === 0;
}

async function main(): Promise<number> {
  const envFile = path.join(ROOT, '.env');
  const port = portFromEnvFile(fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null);
  const pids = listeningPids(port);
  if (pids.length === 0) {
    console.log(`Nenhum servidor da Central em execução (porta ${port} livre).`);
    return 0;
  }
  let stopped = 0;
  for (const pid of pids) {
    const cmd = commandLineOf(pid);
    if (!isCentralServer(cmd, ROOT)) {
      console.error(`A porta ${port} está em uso por outro programa (PID ${pid}); nada foi encerrado.`);
      continue;
    }
    try {
      process.kill(pid);
      stopped += 1;
      console.log(`Servidor da Central encerrado (PID ${pid}, porta ${port}).`);
    } catch (error) {
      console.error(`Não foi possível encerrar o PID ${pid}: ${(error as Error).message}`);
    }
  }
  if (stopped === 0) return 1;
  if (!(await waitUntilFree(port))) {
    console.error(`O processo foi sinalizado, mas a porta ${port} continua ocupada.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
