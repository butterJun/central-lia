import type { Db } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { parseJson } from '../lib/json.ts';

/** Small key/value store for application state (Drive tokens, registry baseline...). */
export class KvRepo {
  constructor(private readonly db: Db) {}

  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? parseJson<T | null>(row.value, null) : null;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), nowIso());
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  }
}
