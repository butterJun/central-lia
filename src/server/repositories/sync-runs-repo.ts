import type { SyncRun, SyncRunStats, SyncRunStatus, SyncTrigger } from '../../shared/domain.ts';
import type { Db } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { parseJson } from '../lib/json.ts';

interface SyncRunRow {
  id: number;
  trigger: SyncTrigger;
  started_at: string;
  finished_at: string | null;
  status: SyncRunStatus;
  stats_json: string | null;
  error: string | null;
}

function toRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    stats: parseJson<SyncRunStats | null>(row.stats_json, null),
    error: row.error,
  };
}

export class SyncRunsRepo {
  constructor(private readonly db: Db) {}

  start(trigger: SyncTrigger): number {
    const result = this.db
      .prepare("INSERT INTO sync_runs (trigger, started_at, status) VALUES (?, ?, 'running')")
      .run(trigger, nowIso());
    return Number(result.lastInsertRowid);
  }

  finish(id: number, status: SyncRunStatus, stats: SyncRunStats | null, error: string | null): void {
    this.db
      .prepare('UPDATE sync_runs SET finished_at = ?, status = ?, stats_json = ?, error = ? WHERE id = ?')
      .run(nowIso(), status, stats ? JSON.stringify(stats) : null, error, id);
  }

  /** Runs left 'running' by a crash are closed on startup so the UI does not lie. */
  closeInterrupted(): void {
    this.db
      .prepare(
        "UPDATE sync_runs SET status = 'failed', finished_at = ?, error = 'Interrompida (aplicação reiniciada)' WHERE status = 'running'",
      )
      .run(nowIso());
  }

  latest(): SyncRun | null {
    const row = this.db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get() as SyncRunRow | undefined;
    return row ? toRun(row) : null;
  }

  lastSuccessAt(): string | null {
    const row = this.db
      .prepare("SELECT finished_at FROM sync_runs WHERE status IN ('success', 'partial') ORDER BY id DESC LIMIT 1")
      .get() as { finished_at: string } | undefined;
    return row?.finished_at ?? null;
  }

  list(limit: number): SyncRun[] {
    const rows = this.db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?').all(limit) as unknown as SyncRunRow[];
    return rows.map(toRun);
  }
}
