import type {
  ProposedFields,
  Suggestion,
  SuggestionKind,
  SuggestionStatus,
} from '../../shared/domain.ts';
import type { Db } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { NotFoundError } from '../lib/errors.ts';
import { parseJson } from '../lib/json.ts';
import type { MembersRepo } from './members-repo.ts';
import type { SourcesRepo } from './sources-repo.ts';

export interface NewSuggestion {
  id: string;
  fingerprint: string;
  sourceFileId: string;
  sourceVersion: string;
  kind: SuggestionKind;
  targetActivityId: string | null;
  proposed: ProposedFields;
  baseline: ProposedFields;
  evidence: string;
  location: string;
  reason: string;
  uncertainties: string[];
  generator: string;
  possibleDuplicateOf: string | null;
}

export interface ReviewOutcome {
  status: Extract<SuggestionStatus, 'accepted' | 'adjusted' | 'rejected'>;
  reviewerId: string;
  note: string | null;
  applied: ProposedFields | null;
  resultActivityId: string | null;
}

interface SuggestionRow {
  suggestion_id: string;
  fingerprint: string;
  source_file_id: string;
  source_version: string;
  kind: SuggestionKind;
  target_activity_id: string | null;
  proposed_json: string;
  baseline_json: string;
  evidence: string;
  location: string;
  reason: string;
  uncertainties_json: string;
  generator: string;
  status: SuggestionStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  applied_json: string | null;
  result_activity_id: string | null;
  possible_duplicate_of: string | null;
  created_at: string;
}

export class SuggestionsRepo {
  constructor(
    private readonly db: Db,
    private readonly sources: SourcesRepo,
    private readonly members: MembersRepo,
  ) {}

  /** Returns false when an identical suggestion (same fingerprint) already exists — idempotency. */
  insert(suggestion: NewSuggestion): boolean {
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO suggestions (suggestion_id, fingerprint, source_file_id, source_version, kind, target_activity_id,
           proposed_json, baseline_json, evidence, location, reason, uncertainties_json, generator, status,
           possible_duplicate_of, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
         ON CONFLICT(fingerprint) DO NOTHING`,
      )
      .run(
        suggestion.id,
        suggestion.fingerprint,
        suggestion.sourceFileId,
        suggestion.sourceVersion,
        suggestion.kind,
        suggestion.targetActivityId,
        JSON.stringify(suggestion.proposed),
        JSON.stringify(suggestion.baseline),
        suggestion.evidence,
        suggestion.location,
        suggestion.reason,
        JSON.stringify(suggestion.uncertainties),
        suggestion.generator,
        suggestion.possibleDuplicateOf,
        now,
        now,
      );
    return Number(result.changes) > 0;
  }

  findByFingerprint(fingerprint: string): { id: string; status: SuggestionStatus } | undefined {
    const row = this.db
      .prepare('SELECT suggestion_id, status FROM suggestions WHERE fingerprint = ?')
      .get(fingerprint) as { suggestion_id: string; status: SuggestionStatus } | undefined;
    return row ? { id: row.suggestion_id, status: row.status } : undefined;
  }

  get(id: string): Suggestion | undefined {
    const row = this.db.prepare('SELECT * FROM suggestions WHERE suggestion_id = ?').get(id) as SuggestionRow | undefined;
    return row ? this.toSuggestion(row) : undefined;
  }

  require(id: string): Suggestion {
    const suggestion = this.get(id);
    if (!suggestion) throw new NotFoundError(`Sugestão ${id} não encontrada`);
    return suggestion;
  }

  list(statuses?: SuggestionStatus[]): Suggestion[] {
    const rows = (
      statuses && statuses.length > 0
        ? this.db
            .prepare(
              `SELECT * FROM suggestions WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at DESC`,
            )
            .all(...statuses)
        : this.db.prepare('SELECT * FROM suggestions ORDER BY created_at DESC').all()
    ) as unknown as SuggestionRow[];
    return rows.map((row) => this.toSuggestion(row));
  }

  listPendingBySource(fileId: string): Suggestion[] {
    const rows = this.db
      .prepare("SELECT * FROM suggestions WHERE source_file_id = ? AND status = 'pending'")
      .all(fileId) as unknown as SuggestionRow[];
    return rows.map((row) => this.toSuggestion(row));
  }

  listPendingByTarget(activityId: string): Suggestion[] {
    const rows = this.db
      .prepare("SELECT * FROM suggestions WHERE target_activity_id = ? AND status = 'pending'")
      .all(activityId) as unknown as SuggestionRow[];
    return rows.map((row) => this.toSuggestion(row));
  }

  countPending(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM suggestions WHERE status = 'pending'").get() as {
      total: number;
    };
    return row.total;
  }

  /** Closes a pending suggestion. Returns false if someone already reviewed it (no double apply). */
  markReviewed(id: string, outcome: ReviewOutcome): boolean {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE suggestions SET status = ?, reviewer_id = ?, reviewed_at = ?, review_note = ?, applied_json = ?,
           result_activity_id = ?, updated_at = ? WHERE suggestion_id = ? AND status = 'pending'`,
      )
      .run(
        outcome.status,
        outcome.reviewerId,
        now,
        outcome.note,
        outcome.applied ? JSON.stringify(outcome.applied) : null,
        outcome.resultActivityId,
        now,
        id,
      );
    return Number(result.changes) > 0;
  }

  supersede(id: string, note: string): void {
    this.db
      .prepare(
        "UPDATE suggestions SET status = 'superseded', review_note = ?, updated_at = ? WHERE suggestion_id = ? AND status = 'pending'",
      )
      .run(note, nowIso(), id);
  }

  /** A newer version of the same document still supports this suggestion: point it at that version. */
  refreshSource(id: string, sourceVersion: string, evidence: string, location: string): void {
    this.db
      .prepare('UPDATE suggestions SET source_version = ?, evidence = ?, location = ?, updated_at = ? WHERE suggestion_id = ?')
      .run(sourceVersion, evidence, location, nowIso(), id);
  }

  /** The document supports a previously superseded proposal again: back to pending, with fresh evidence. */
  reopen(id: string, sourceVersion: string, draft: Pick<NewSuggestion, 'baseline' | 'evidence' | 'location' | 'reason' | 'uncertainties'>): void {
    this.db
      .prepare(
        `UPDATE suggestions SET status = 'pending', review_note = NULL, source_version = ?, baseline_json = ?, evidence = ?,
           location = ?, reason = ?, uncertainties_json = ?, updated_at = ? WHERE suggestion_id = ? AND status = 'superseded'`,
      )
      .run(sourceVersion, JSON.stringify(draft.baseline), draft.evidence, draft.location, draft.reason, JSON.stringify(draft.uncertainties), nowIso(), id);
  }

  addUncertainty(id: string, text: string): void {
    const suggestion = this.require(id);
    if (suggestion.uncertainties.includes(text)) return;
    this.db
      .prepare('UPDATE suggestions SET uncertainties_json = ?, updated_at = ? WHERE suggestion_id = ?')
      .run(JSON.stringify([...suggestion.uncertainties, text]), nowIso(), id);
  }

  private toSuggestion(row: SuggestionRow): Suggestion {
    const source = this.sources.get(row.source_file_id);
    const target = row.target_activity_id
      ? (this.db.prepare('SELECT title FROM activities WHERE activity_id = ?').get(row.target_activity_id) as
          | { title: string }
          | undefined)
      : undefined;
    return {
      id: row.suggestion_id,
      kind: row.kind,
      targetActivityId: row.target_activity_id,
      targetActivityTitle: target?.title ?? null,
      proposed: parseJson<ProposedFields>(row.proposed_json, {}),
      baseline: parseJson<ProposedFields>(row.baseline_json, {}),
      evidence: row.evidence,
      location: row.location,
      reason: row.reason,
      uncertainties: parseJson<string[]>(row.uncertainties_json, []),
      generator: row.generator,
      status: row.status,
      reviewerId: row.reviewer_id,
      reviewerName: row.reviewer_id ? this.members.displayName(row.reviewer_id) : null,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      appliedFields: parseJson<ProposedFields | null>(row.applied_json, null),
      resultActivityId: row.result_activity_id,
      possibleDuplicateOf: row.possible_duplicate_of,
      createdAt: row.created_at,
      source: {
        ...this.sources.link(row.source_file_id),
        versionOrHash: row.source_version,
        docDate: source?.docDate ?? null,
      },
    };
  }
}
