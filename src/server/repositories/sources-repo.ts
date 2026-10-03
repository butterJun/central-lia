import type {
  Source,
  SourceAnalysis,
  SourceLink,
  SourceRole,
  SourceSyncStatus,
} from '../../shared/domain.ts';
import type { Db } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { describeMimeType } from '../drive/types.ts';
import { parseJson } from '../lib/json.ts';

/** Metadata observed in the Drive listing. */
export interface ObservedFile {
  fileId: string;
  name: string;
  mimeType: string;
  webUrl: string;
  modifiedAt: string;
  versionOrHash: string;
  path: string;
}

export interface SourceRecord extends Source {
  contentHash: string | null;
  firstSeenAt: string;
}

export interface SourceProcessingPatch {
  syncStatus?: SourceSyncStatus;
  statusDetail?: string | null;
  role?: SourceRole;
  docStatus?: string | null;
  docDate?: string | null;
  contentHash?: string | null;
  analysis?: SourceAnalysis | null;
  lastProcessedAt?: string | null;
}

export interface StoredContent {
  versionOrHash: string;
  text: string;
  tables: unknown;
}

interface SourceRow {
  file_id: string;
  name: string;
  mime_type: string;
  web_url: string;
  modified_at: string;
  version_or_hash: string;
  path: string;
  sync_status: SourceSyncStatus;
  status_detail: string | null;
  role: SourceRole;
  doc_status: string | null;
  doc_date: string | null;
  content_hash: string | null;
  analysis_json: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_processed_at: string | null;
}

const PATCH_COLUMNS: Record<keyof SourceProcessingPatch, string> = {
  syncStatus: 'sync_status',
  statusDetail: 'status_detail',
  role: 'role',
  docStatus: 'doc_status',
  docDate: 'doc_date',
  contentHash: 'content_hash',
  analysis: 'analysis_json',
  lastProcessedAt: 'last_processed_at',
};

function toRecord(row: SourceRow): SourceRecord {
  return {
    fileId: row.file_id,
    name: row.name,
    mimeType: row.mime_type,
    kindLabel: describeMimeType(row.mime_type, row.name),
    webUrl: row.web_url,
    modifiedAt: row.modified_at,
    versionOrHash: row.version_or_hash,
    path: row.path,
    syncStatus: row.sync_status,
    statusDetail: row.status_detail,
    role: row.role,
    docStatus: row.doc_status,
    docDate: row.doc_date,
    lastProcessedAt: row.last_processed_at,
    lastSeenAt: row.last_seen_at,
    analysis: parseJson<SourceAnalysis | null>(row.analysis_json, null),
    contentHash: row.content_hash,
    firstSeenAt: row.first_seen_at,
  };
}

export class SourcesRepo {
  constructor(private readonly db: Db) {}

  get(fileId: string): SourceRecord | undefined {
    const row = this.db.prepare('SELECT * FROM sources WHERE file_id = ?').get(fileId) as SourceRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  list(): SourceRecord[] {
    const rows = this.db.prepare('SELECT * FROM sources ORDER BY path, name').all() as unknown as SourceRow[];
    return rows.map(toRecord);
  }

  /** Records that a file was seen in the listing. New files start as 'failed' until processed. */
  upsertObserved(file: ObservedFile): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO sources (file_id, name, mime_type, web_url, modified_at, version_or_hash, path, sync_status,
           status_detail, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', 'Aguardando processamento', ?, ?)
         ON CONFLICT(file_id) DO UPDATE SET name = excluded.name, mime_type = excluded.mime_type,
           web_url = excluded.web_url, modified_at = excluded.modified_at,
           version_or_hash = excluded.version_or_hash, path = excluded.path, last_seen_at = excluded.last_seen_at`,
      )
      .run(file.fileId, file.name, file.mimeType, file.webUrl, file.modifiedAt, file.versionOrHash, file.path, now, now);
  }

  patch(fileId: string, patch: SourceProcessingPatch): void {
    const entries = Object.entries(patch) as Array<[keyof SourceProcessingPatch, unknown]>;
    if (entries.length === 0) return;
    const assignments = entries.map(([key]) => `${PATCH_COLUMNS[key]} = ?`).join(', ');
    const values = entries.map(([key, value]) =>
      key === 'analysis' ? (value ? JSON.stringify(value) : null) : (value as string | null),
    );
    this.db.prepare(`UPDATE sources SET ${assignments} WHERE file_id = ?`).run(...values, fileId);
  }

  saveContent(fileId: string, versionOrHash: string, text: string, tables: unknown): void {
    this.db
      .prepare(
        `INSERT INTO source_contents (file_id, version_or_hash, text, tables_json, extracted_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(file_id) DO UPDATE SET version_or_hash = excluded.version_or_hash, text = excluded.text,
           tables_json = excluded.tables_json, extracted_at = excluded.extracted_at`,
      )
      .run(fileId, versionOrHash, text, tables === undefined ? null : JSON.stringify(tables), nowIso());
  }

  getContent(fileId: string): StoredContent | null {
    const row = this.db
      .prepare('SELECT version_or_hash, text, tables_json FROM source_contents WHERE file_id = ?')
      .get(fileId) as { version_or_hash: string; text: string; tables_json: string | null } | undefined;
    return row ? { versionOrHash: row.version_or_hash, text: row.text, tables: parseJson(row.tables_json, null) } : null;
  }

  /** Cached text is dropped when the source disappears or access is revoked (minimal retention). */
  deleteContent(fileId: string): void {
    this.db.prepare('DELETE FROM source_contents WHERE file_id = ?').run(fileId);
  }

  link(fileId: string): SourceLink {
    const source = this.get(fileId);
    if (!source) return { fileId, name: fileId, webUrl: '', syncStatus: 'unavailable' };
    return { fileId, name: source.name, webUrl: source.webUrl, syncStatus: source.syncStatus };
  }

  counts(): Record<SourceSyncStatus, number> {
    const rows = this.db.prepare('SELECT sync_status, COUNT(*) AS total FROM sources GROUP BY sync_status').all() as Array<{
      sync_status: SourceSyncStatus;
      total: number;
    }>;
    const counts: Record<SourceSyncStatus, number> = { processed: 0, failed: 0, ignored: 0, unsupported: 0, unavailable: 0 };
    for (const row of rows) counts[row.sync_status] = row.total;
    return counts;
  }
}
