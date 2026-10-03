import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema migrations, applied in order and tracked with PRAGMA user_version.
 * Dates are ISO strings: `YYYY-MM-DD` for due dates, UTC timestamps elsewhere.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE members (
    member_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    front TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('member', 'reviewer')),
    description TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE sources (
    file_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    web_url TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    version_or_hash TEXT NOT NULL,
    path TEXT NOT NULL,
    sync_status TEXT NOT NULL,
    status_detail TEXT,
    role TEXT NOT NULL DEFAULT 'other',
    doc_status TEXT,
    doc_date TEXT,
    content_hash TEXT,
    analysis_json TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_processed_at TEXT
  );

  CREATE TABLE source_contents (
    file_id TEXT PRIMARY KEY REFERENCES sources(file_id) ON DELETE CASCADE,
    version_or_hash TEXT NOT NULL,
    text TEXT NOT NULL,
    tables_json TEXT,
    extracted_at TEXT NOT NULL
  );

  CREATE TABLE activities (
    activity_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    front TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
    due_date TEXT,
    priority TEXT,
    notes TEXT,
    unresolved_owners TEXT NOT NULL DEFAULT '[]',
    origin TEXT NOT NULL CHECK (origin IN ('import', 'manual', 'suggestion')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE activity_owners (
    activity_id TEXT NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(member_id),
    PRIMARY KEY (activity_id, member_id)
  );

  CREATE TABLE activity_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id TEXT NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
    file_id TEXT NOT NULL,
    version_or_hash TEXT NOT NULL,
    location TEXT NOT NULL,
    quote TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX activity_refs_activity ON activity_refs(activity_id);

  CREATE TABLE activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id TEXT NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    kind TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    reason TEXT,
    source_file_id TEXT,
    source_version TEXT,
    suggestion_id TEXT
  );
  CREATE INDEX activity_events_activity ON activity_events(activity_id, timestamp);

  CREATE TABLE suggestions (
    suggestion_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    source_file_id TEXT NOT NULL,
    source_version TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('create', 'update')),
    target_activity_id TEXT,
    proposed_json TEXT NOT NULL,
    baseline_json TEXT NOT NULL,
    evidence TEXT NOT NULL,
    location TEXT NOT NULL,
    reason TEXT NOT NULL,
    uncertainties_json TEXT NOT NULL,
    generator TEXT NOT NULL,
    status TEXT NOT NULL,
    reviewer_id TEXT,
    reviewed_at TEXT,
    review_note TEXT,
    applied_json TEXT,
    result_activity_id TEXT,
    possible_duplicate_of TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX suggestions_status ON suggestions(status);
  CREATE INDEX suggestions_source ON suggestions(source_file_id);

  CREATE TABLE conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    file_id TEXT,
    dedupe_key TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    resolution TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    stats_json TEXT,
    error TEXT
  );

  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE member_visits (
    member_id TEXT PRIMARY KEY REFERENCES members(member_id),
    last_visit_at TEXT NOT NULL,
    previous_visit_at TEXT
  );
  `,
];

export function runMigrations(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let index = row.user_version; index < MIGRATIONS.length; index += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[index] as string);
      db.exec(`PRAGMA user_version = ${index + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
