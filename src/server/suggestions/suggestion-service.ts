import {
  ACTIVITY_FIELD_LABELS,
  type ActivityField,
  type SourceAnalysis,
  type Suggestion,
  type SuggestionStatus,
} from '../../shared/domain.ts';
import { transaction, type Db } from '../db/database.ts';
import { errorMessage } from '../lib/errors.ts';
import { stableStringify } from '../lib/json.ts';
import { sha256 } from '../lib/text.ts';
import type { ActivitiesRepo } from '../repositories/activities-repo.ts';
import type { ConflictsRepo } from '../repositories/conflicts-repo.ts';
import type { MembersRepo } from '../repositories/members-repo.ts';
import type { SourceRecord } from '../repositories/sources-repo.ts';
import type { SuggestionsRepo } from '../repositories/suggestions-repo.ts';
import type { MinutesAnalyzer, SuggestionDraft } from './contract.ts';
import { validateProposals } from './validator.ts';

export interface SaveDraftsResult {
  created: number;
  superseded: number;
}

/**
 * Turns documents into pending suggestions. Guarantees:
 *  - idempotency: the same proposal from the same file is stored once (fingerprint
 *    excludes the file version), so repeated sync events never duplicate;
 *  - a new version of a document supersedes pending suggestions it no longer supports;
 *  - conflicting pending proposals for the same field are flagged for a human.
 */
export class SuggestionService {
  constructor(
    private readonly db: Db,
    private readonly suggestions: SuggestionsRepo,
    private readonly activities: ActivitiesRepo,
    private readonly members: MembersRepo,
    private readonly conflicts: ConflictsRepo,
    private readonly analyzer: MinutesAnalyzer,
    private readonly fallbackAnalyzer: MinutesAnalyzer,
  ) {}

  list(statuses?: SuggestionStatus[]): Suggestion[] {
    return this.suggestions.list(statuses);
  }

  get(id: string): Suggestion {
    return this.suggestions.require(id);
  }

  /** Reads a document with the analyzer (falling back to rules on failure) and stores validated suggestions. */
  async analyzeDocument(source: SourceRecord, text: string): Promise<SourceAnalysis> {
    const activities = this.activities.list();
    const input = { documentName: source.name, documentDate: source.docDate, documentText: text, activities, members: this.members.list() };
    const warnings: string[] = [];
    let output;
    let degraded = false;
    try {
      output = await this.analyzer.analyze(input);
    } catch (error) {
      if (this.analyzer === this.fallbackAnalyzer) throw error;
      degraded = true;
      warnings.push(`IA indisponível (${errorMessage(error)}); usada a extração por regras. Nova tentativa na próxima sincronização.`);
      output = await this.fallbackAnalyzer.analyze(input);
    }
    const { drafts, ignored } = validateProposals(output.proposals, {
      documentText: text,
      documentDate: source.docDate,
      activities,
      members: input.members,
      lastHumanChangeAt: (id) => this.activities.lastHumanChangeAt(id),
    });
    const saved = this.saveDrafts(source, drafts, output.generator);
    return {
      generator: output.generator,
      analyzedVersion: source.versionOrHash,
      contentHash: sha256(text),
      degraded,
      suggestionsCreated: saved.created,
      ignored,
      warnings: [...output.warnings, ...warnings],
    };
  }

  saveDrafts(source: SourceRecord, drafts: SuggestionDraft[], generator: string): SaveDraftsResult {
    return transaction(this.db, () => {
      const fingerprints = new Set<string>();
      let created = 0;
      for (const draft of drafts) {
        const fingerprint = fingerprintOf(source.fileId, draft);
        fingerprints.add(fingerprint);
        const existing = this.suggestions.findByFingerprint(fingerprint);
        if (existing?.status === 'pending') {
          this.suggestions.refreshSource(existing.id, source.versionOrHash, draft.evidence, draft.location);
          continue;
        }
        if (existing?.status === 'superseded') {
          this.suggestions.reopen(existing.id, source.versionOrHash, draft);
          created += 1;
          continue;
        }
        if (existing) continue;
        const inserted = this.suggestions.insert({
          ...draft,
          id: `S-${fingerprint.slice(0, 10)}`,
          fingerprint,
          sourceFileId: source.fileId,
          sourceVersion: source.versionOrHash,
          generator,
        });
        if (inserted) created += 1;
      }
      const superseded = this.supersedeUnsupported(source, fingerprints);
      this.flagConflictingSuggestions();
      return { created, superseded };
    });
  }

  /** The file is gone or unreadable: pending suggestions that depend on it cannot be trusted. */
  supersedeAllFrom(fileId: string, note: string): number {
    const pending = this.suggestions.listPendingBySource(fileId);
    for (const suggestion of pending) this.suggestions.supersede(suggestion.id, note);
    return pending.length;
  }

  private supersedeUnsupported(source: SourceRecord, keep: Set<string>): number {
    let count = 0;
    for (const suggestion of this.suggestions.listPendingBySource(source.fileId)) {
      const fingerprint = fingerprintOf(source.fileId, suggestion);
      if (keep.has(fingerprint)) continue;
      this.suggestions.supersede(suggestion.id, 'A versão nova do documento não sustenta mais esta sugestão.');
      count += 1;
    }
    return count;
  }

  /** Two pending suggestions proposing different values for the same field of the same activity. */
  private flagConflictingSuggestions(): void {
    const byTarget = new Map<string, Suggestion[]>();
    for (const suggestion of this.suggestions.list(['pending'])) {
      if (!suggestion.targetActivityId || suggestion.kind !== 'update') continue;
      byTarget.set(suggestion.targetActivityId, [...(byTarget.get(suggestion.targetActivityId) ?? []), suggestion]);
    }
    for (const [activityId, group] of byTarget) {
      for (const [index, left] of group.entries()) {
        for (const right of group.slice(index + 1)) this.flagPair(activityId, left, right);
      }
    }
  }

  private flagPair(activityId: string, left: Suggestion, right: Suggestion): void {
    if (left.source.fileId === right.source.fileId) return;
    const fields = (Object.keys(left.proposed) as ActivityField[]).filter(
      (field) => field in right.proposed && stableStringify(left.proposed[field]) !== stableStringify(right.proposed[field]),
    );
    if (fields.length === 0) return;
    const labels = fields.map((field) => ACTIVITY_FIELD_LABELS[field]).join(', ');
    this.suggestions.addUncertainty(left.id, `Conflita com ${right.id} (${right.source.name}) no campo ${labels}.`);
    this.suggestions.addUncertainty(right.id, `Conflita com ${left.id} (${left.source.name}) no campo ${labels}.`);
    const [first, second] = [left.id, right.id].sort();
    this.conflicts.open(
      'conflicting_suggestions',
      left.source.fileId,
      `conflicting:${first}:${second}`,
      `Fontes ativas discordam sobre ${activityId} (${labels}): ${left.source.name} × ${right.source.name}. Revise as sugestões ${first} e ${second}.`,
    );
  }
}

function fingerprintOf(
  fileId: string,
  draft: Pick<SuggestionDraft, 'kind' | 'targetActivityId' | 'proposed'>,
): string {
  return sha256(stableStringify({ fileId, kind: draft.kind, target: draft.targetActivityId, proposed: draft.proposed }));
}
