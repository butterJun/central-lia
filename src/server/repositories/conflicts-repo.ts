import type { Conflict, ConflictKind } from '../../shared/domain.ts';
import type { Db } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { NotFoundError } from '../lib/errors.ts';
import type { SourcesRepo } from './sources-repo.ts';

interface ConflictRow {
  id: number;
  kind: ConflictKind;
  file_id: string | null;
  description: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** Conflicts are situations the system refuses to decide alone; a person must look at them. */
export class ConflictsRepo {
  constructor(
    private readonly db: Db,
    private readonly sources: SourcesRepo,
  ) {}

  /** Idempotent: the same situation (dedupe key) is recorded only once. Returns true when new. */
  open(kind: ConflictKind, fileId: string | null, dedupeKey: string, description: string): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO conflicts (kind, file_id, dedupe_key, description, status, created_at)
         VALUES (?, ?, ?, ?, 'open', ?) ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(kind, fileId, dedupeKey, description, nowIso());
    return Number(result.changes) > 0;
  }

  resolve(id: number, resolution: string, memberId: string): Conflict {
    const result = this.db
      .prepare(
        "UPDATE conflicts SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'",
      )
      .run(resolution, memberId, nowIso(), id);
    if (Number(result.changes) === 0) throw new NotFoundError(`Conflito ${id} não encontrado ou já resolvido`);
    return this.require(id);
  }

  require(id: number): Conflict {
    const row = this.db.prepare('SELECT * FROM conflicts WHERE id = ?').get(id) as ConflictRow | undefined;
    if (!row) throw new NotFoundError(`Conflito ${id} não encontrado`);
    return this.toConflict(row);
  }

  list(): Conflict[] {
    const rows = this.db
      .prepare("SELECT * FROM conflicts ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, id DESC")
      .all() as unknown as ConflictRow[];
    return rows.map((row) => this.toConflict(row));
  }

  countOpen(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM conflicts WHERE status = 'open'").get() as { total: number };
    return row.total;
  }

  private toConflict(row: ConflictRow): Conflict {
    return {
      id: row.id,
      kind: row.kind,
      source: row.file_id ? this.sources.link(row.file_id) : null,
      description: row.description,
      status: row.status,
      resolution: row.resolution,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    };
  }
}
