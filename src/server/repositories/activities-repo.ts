import type {
  Activity,
  ActivityEvent,
  ActivityFields,
  ActivityOrigin,
  ActivityRef,
  ActivityStatus,
  FieldChange,
  ProposedFields,
} from '../../shared/domain.ts';
import type { Db } from '../db/database.ts';
import { ConflictError, NotFoundError } from '../lib/errors.ts';
import { parseJson } from '../lib/json.ts';
import type { MembersRepo } from './members-repo.ts';
import type { SourcesRepo } from './sources-repo.ts';

export interface NewActivity extends ActivityFields {
  id: string;
  priority: string | null;
  notes: string | null;
  unresolvedOwners: string[];
  origin: ActivityOrigin;
  createdBy: string;
  createdAt: string;
}

export interface NewRef {
  activityId: string;
  fileId: string;
  versionOrHash: string;
  location: string;
  quote: string;
  relationType: ActivityRef['relationType'];
  createdAt: string;
}

export interface NewEvent {
  activityId: string;
  actorId: string;
  timestamp: string;
  kind: ActivityEvent['kind'];
  changes: FieldChange[];
  reason: string | null;
  sourceFileId: string | null;
  sourceVersion: string | null;
  suggestionId: string | null;
}

interface ActivityRow {
  activity_id: string;
  title: string;
  description: string;
  next_step: string;
  front: string;
  status: ActivityStatus;
  due_date: string | null;
  priority: string | null;
  notes: string | null;
  unresolved_owners: string;
  origin: ActivityOrigin;
  created_at: string;
  updated_at: string;
  created_by: string;
  version: number;
}

interface RefRow {
  file_id: string;
  version_or_hash: string;
  location: string;
  quote: string;
  relation_type: ActivityRef['relationType'];
  created_at: string;
}

interface EventRow {
  id: number;
  activity_id: string;
  actor_id: string;
  timestamp: string;
  kind: ActivityEvent['kind'];
  changes_json: string;
  reason: string | null;
  source_file_id: string | null;
  source_version: string | null;
  suggestion_id: string | null;
}

const FIELD_COLUMNS: Record<Exclude<keyof ActivityFields, 'ownerIds'>, string> = {
  title: 'title',
  description: 'description',
  nextStep: 'next_step',
  front: 'front',
  status: 'status',
  dueDate: 'due_date',
};

const FIRST_ACTIVITY_NUMBER = 101;

export class ActivitiesRepo {
  constructor(
    private readonly db: Db,
    private readonly sources: SourcesRepo,
    private readonly members: MembersRepo,
  ) {}

  insert(activity: NewActivity): void {
    this.db
      .prepare(
        `INSERT INTO activities (activity_id, title, description, next_step, front, status, due_date, priority, notes,
           unresolved_owners, origin, created_at, updated_at, created_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        activity.id,
        activity.title,
        activity.description,
        activity.nextStep,
        activity.front,
        activity.status,
        activity.dueDate,
        activity.priority,
        activity.notes,
        JSON.stringify(activity.unresolvedOwners),
        activity.origin,
        activity.createdAt,
        activity.createdAt,
        activity.createdBy,
      );
    this.setOwners(activity.id, activity.ownerIds);
  }

  /** Applies field changes with optimistic locking; returns the new version. */
  applyFields(id: string, fields: ProposedFields, expectedVersion: number, now: string): number {
    const scalarEntries = Object.entries(fields).filter(([key]) => key in FIELD_COLUMNS) as Array<
      [keyof typeof FIELD_COLUMNS, string | null]
    >;
    const assignments = scalarEntries.map(([key]) => `${FIELD_COLUMNS[key]} = ?`);
    const sql = `UPDATE activities SET ${[...assignments, 'updated_at = ?', 'version = version + 1'].join(', ')}
                 WHERE activity_id = ? AND version = ?`;
    const result = this.db.prepare(sql).run(...scalarEntries.map(([, value]) => value), now, id, expectedVersion);
    if (Number(result.changes) === 0) {
      if (!this.exists(id)) throw new NotFoundError(`Atividade ${id} não encontrada`);
      throw new ConflictError('A atividade foi alterada por outra pessoa. Recarregue para ver a versão atual.');
    }
    if (fields.ownerIds) {
      this.setOwners(id, fields.ownerIds);
      this.db.prepare("UPDATE activities SET unresolved_owners = '[]' WHERE activity_id = ?").run(id);
    }
    return expectedVersion + 1;
  }

  exists(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM activities WHERE activity_id = ?').get(id));
  }

  get(id: string): Activity | undefined {
    const row = this.db.prepare('SELECT * FROM activities WHERE activity_id = ?').get(id) as ActivityRow | undefined;
    return row ? this.toActivity(row) : undefined;
  }

  require(id: string): Activity {
    const activity = this.get(id);
    if (!activity) throw new NotFoundError(`Atividade ${id} não encontrada`);
    return activity;
  }

  list(): Activity[] {
    const rows = this.db.prepare('SELECT * FROM activities ORDER BY activity_id').all() as unknown as ActivityRow[];
    return rows.map((row) => this.toActivity(row));
  }

  addRef(ref: NewRef): void {
    this.db
      .prepare(
        `INSERT INTO activity_refs (activity_id, file_id, version_or_hash, location, quote, relation_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ref.activityId, ref.fileId, ref.versionOrHash, ref.location, ref.quote, ref.relationType, ref.createdAt);
  }

  addEvent(event: NewEvent): void {
    this.db
      .prepare(
        `INSERT INTO activity_events (activity_id, actor_id, timestamp, kind, changes_json, reason, source_file_id,
           source_version, suggestion_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.activityId,
        event.actorId,
        event.timestamp,
        event.kind,
        JSON.stringify(event.changes),
        event.reason,
        event.sourceFileId,
        event.sourceVersion,
        event.suggestionId,
      );
  }

  listEvents(activityId: string): ActivityEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM activity_events WHERE activity_id = ? ORDER BY timestamp DESC, id DESC')
      .all(activityId) as unknown as EventRow[];
    return rows.map((row) => this.toEvent(row));
  }

  listEventsSince(since: string): ActivityEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM activity_events WHERE timestamp > ? ORDER BY timestamp DESC, id DESC')
      .all(since) as unknown as EventRow[];
    return rows.map((row) => this.toEvent(row));
  }

  /** Latest timestamp of a human-driven change (manual edit or reviewed suggestion). */
  lastHumanChangeAt(activityId: string): string | null {
    const row = this.db
      .prepare("SELECT MAX(timestamp) AS latest FROM activity_events WHERE activity_id = ? AND kind != 'imported'")
      .get(activityId) as { latest: string | null };
    return row.latest;
  }

  nextId(): string {
    const rows = this.db.prepare("SELECT activity_id FROM activities WHERE activity_id LIKE 'ACT-%'").all() as Array<{
      activity_id: string;
    }>;
    const numbers = rows.map((row) => Number(row.activity_id.slice(4))).filter(Number.isFinite);
    const next = Math.max(FIRST_ACTIVITY_NUMBER - 1, ...numbers) + 1;
    return `ACT-${next}`;
  }

  private setOwners(activityId: string, ownerIds: string[]): void {
    this.db.prepare('DELETE FROM activity_owners WHERE activity_id = ?').run(activityId);
    const insert = this.db.prepare('INSERT OR IGNORE INTO activity_owners (activity_id, member_id) VALUES (?, ?)');
    for (const ownerId of ownerIds) insert.run(activityId, ownerId);
  }

  private toActivity(row: ActivityRow): Activity {
    const owners = this.db
      .prepare('SELECT member_id FROM activity_owners WHERE activity_id = ? ORDER BY member_id')
      .all(row.activity_id) as Array<{ member_id: string }>;
    const pending = this.db
      .prepare("SELECT suggestion_id FROM suggestions WHERE target_activity_id = ? AND status = 'pending' ORDER BY created_at")
      .all(row.activity_id) as Array<{ suggestion_id: string }>;
    const refs = this.db
      .prepare('SELECT * FROM activity_refs WHERE activity_id = ? ORDER BY created_at, id')
      .all(row.activity_id) as unknown as RefRow[];
    return {
      id: row.activity_id,
      title: row.title,
      description: row.description,
      nextStep: row.next_step,
      ownerIds: owners.map((owner) => owner.member_id),
      front: row.front,
      status: row.status,
      dueDate: row.due_date,
      unresolvedOwners: parseJson<string[]>(row.unresolved_owners, []),
      priority: row.priority,
      notes: row.notes,
      origin: row.origin,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      version: row.version,
      pendingSuggestionIds: pending.map((item) => item.suggestion_id),
      refs: refs.map((ref) => ({
        source: this.sources.link(ref.file_id),
        versionOrHash: ref.version_or_hash,
        location: ref.location,
        quote: ref.quote,
        relationType: ref.relation_type,
        createdAt: ref.created_at,
      })),
    };
  }

  private toEvent(row: EventRow): ActivityEvent {
    return {
      id: row.id,
      activityId: row.activity_id,
      actorId: row.actor_id,
      actorName: this.members.displayName(row.actor_id),
      timestamp: row.timestamp,
      kind: row.kind,
      changes: parseJson<FieldChange[]>(row.changes_json, []),
      reason: row.reason,
      source: row.source_file_id ? this.sources.link(row.source_file_id) : null,
      suggestionId: row.suggestion_id,
    };
  }
}
