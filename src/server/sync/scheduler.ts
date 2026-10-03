import type { Logger, SyncService } from './sync-service.ts';

/** Upper bound for the retry delay after failures; keeps detection well inside the 15-minute target. */
export const MAX_BACKOFF_SECONDS = 600;

/**
 * Periodic synchronization while the app runs. After a failed run the delay
 * doubles (interval, 2×, 4×...) up to MAX_BACKOFF_SECONDS, and resets on success.
 */
export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;
  private nextRun: Date | null = null;
  private stopped = true;

  constructor(
    private readonly sync: SyncService,
    private readonly intervalSeconds: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.stopped = false;
    this.schedule(0, 'startup');
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextRun = null;
  }

  nextRunAt(): string | null {
    return this.nextRun?.toISOString() ?? null;
  }

  /** Delay before the next automatic run, given consecutive failures. */
  static delaySeconds(intervalSeconds: number, failures: number): number {
    return Math.min(intervalSeconds * 2 ** failures, Math.max(intervalSeconds, MAX_BACKOFF_SECONDS));
  }

  private schedule(delaySeconds: number, trigger: 'auto' | 'startup'): void {
    if (this.stopped) return;
    this.nextRun = new Date(Date.now() + delaySeconds * 1000);
    this.timer = setTimeout(() => void this.tick(trigger), delaySeconds * 1000);
    this.timer.unref?.();
  }

  private async tick(trigger: 'auto' | 'startup'): Promise<void> {
    try {
      const run = await this.sync.run(trigger);
      this.failures = run.status === 'failed' ? this.failures + 1 : 0;
    } catch (error) {
      this.failures += 1;
      this.logger.error(`Erro inesperado no agendador: ${(error as Error).message}`);
    }
    const delay = SyncScheduler.delaySeconds(this.intervalSeconds, this.failures);
    if (this.failures > 0) this.logger.warn(`Nova tentativa de sincronização em ${delay}s (falhas seguidas: ${this.failures}).`);
    this.schedule(delay, 'auto');
  }
}
