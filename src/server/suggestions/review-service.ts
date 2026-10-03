import type { ActivityFields, ProposedFields, Suggestion } from '../../shared/domain.ts';
import { activityFieldsSchema, type ReviewSuggestionInput } from '../../shared/schemas.ts';
import { diffFields, pickFields, sameFieldValue } from '../activities/activity-service.ts';
import { nowIso, transaction, type Db } from '../db/database.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../lib/errors.ts';
import type { ActivitiesRepo } from '../repositories/activities-repo.ts';
import type { MembersRepo } from '../repositories/members-repo.ts';
import type { SuggestionsRepo } from '../repositories/suggestions-repo.ts';

/**
 * Human review of suggestions: the only path by which document-derived
 * information becomes official. Accepting twice, accepting a superseded
 * suggestion, or accepting over a newer human edit is refused.
 */
export class ReviewService {
  constructor(
    private readonly db: Db,
    private readonly suggestions: SuggestionsRepo,
    private readonly activities: ActivitiesRepo,
    private readonly members: MembersRepo,
  ) {}

  review(id: string, input: ReviewSuggestionInput, reviewerId: string): Suggestion {
    const reviewer = this.members.require(reviewerId);
    if (reviewer.role !== 'reviewer') {
      throw new ForbiddenError(`${reviewer.displayName} não tem perfil de revisão. Peça a um revisor (Bruno ou Carla).`);
    }
    return transaction(this.db, () => {
      const suggestion = this.suggestions.require(id);
      if (suggestion.status !== 'pending') {
        throw new ConflictError(`Esta sugestão já está "${suggestion.status}" e não pode ser revisada de novo.`);
      }
      if (input.decision === 'reject') {
        this.close(suggestion, { status: 'rejected', reviewerId, note: input.note, applied: null, resultActivityId: null });
        return this.suggestions.require(id);
      }
      const fields: ProposedFields =
        input.decision === 'adjust' ? { ...suggestion.proposed, ...input.fields } : { ...suggestion.proposed };
      const status = input.decision === 'adjust' && !sameProposal(fields, suggestion.proposed) ? 'adjusted' : 'accepted';
      const note = input.decision === 'adjust' ? (input.note ?? null) : null;
      const resultId =
        suggestion.kind === 'create'
          ? this.createFrom(suggestion, fields, reviewerId, status)
          : this.updateFrom(suggestion, fields, reviewerId, status, input.force ?? false);
      this.close(suggestion, { status, reviewerId, note, applied: fields, resultActivityId: resultId });
      return this.suggestions.require(id);
    });
  }

  private close(suggestion: Suggestion, outcome: Parameters<SuggestionsRepo['markReviewed']>[1]): void {
    if (!this.suggestions.markReviewed(suggestion.id, outcome)) {
      throw new ConflictError('Outra pessoa revisou esta sugestão ao mesmo tempo. Recarregue a página.');
    }
  }

  private updateFrom(
    suggestion: Suggestion,
    fields: ProposedFields,
    reviewerId: string,
    status: 'accepted' | 'adjusted',
    force: boolean,
  ): string {
    const targetId = suggestion.targetActivityId as string;
    const current = this.activities.require(targetId);
    const currentFields = pickFields(current);
    const drifted = (Object.keys(suggestion.baseline) as Array<keyof ActivityFields>).filter(
      (field) => !sameFieldValue(currentFields[field], suggestion.baseline[field]),
    );
    if (drifted.length > 0 && !force) {
      throw new ConflictError(
        'A atividade mudou desde que a sugestão foi criada. Confira os valores atuais e confirme para aplicar mesmo assim.',
        { fields: drifted },
      );
    }
    this.assertValid(fields, true);
    const changes = diffFields(currentFields, fields);
    if (changes.length === 0) return targetId;
    const now = nowIso();
    const applied = Object.fromEntries(changes.map((change) => [change.field, change.after])) as ProposedFields;
    this.activities.applyFields(targetId, applied, current.version, now);
    this.recordProvenance(suggestion, targetId, reviewerId, now, status, changes, 'suggestion_applied', 'updated_by');
    return targetId;
  }

  private createFrom(suggestion: Suggestion, fields: ProposedFields, reviewerId: string, status: 'accepted' | 'adjusted'): string {
    const complete = this.assertValid(fields, false) as ActivityFields;
    const requested = suggestion.targetActivityId;
    const id = requested && !this.activities.exists(requested) ? requested : this.activities.nextId();
    const now = nowIso();
    this.activities.insert({
      ...complete,
      id,
      priority: null,
      notes: null,
      unresolvedOwners: [],
      origin: 'suggestion',
      createdBy: reviewerId,
      createdAt: now,
    });
    const changes = diffFields(
      { title: '', description: '', nextStep: '', ownerIds: [], front: '', status: complete.status, dueDate: null },
      complete,
    );
    this.recordProvenance(suggestion, id, reviewerId, now, status, changes, 'created', 'created_by');
    return id;
  }

  private recordProvenance(
    suggestion: Suggestion,
    activityId: string,
    reviewerId: string,
    timestamp: string,
    status: 'accepted' | 'adjusted',
    changes: ReturnType<typeof diffFields>,
    kind: 'suggestion_applied' | 'created',
    relationType: 'updated_by' | 'created_by',
  ): void {
    const verb = status === 'adjusted' ? 'ajustada e aceita' : 'aceita';
    this.activities.addEvent({
      activityId,
      actorId: reviewerId,
      timestamp,
      kind,
      changes,
      reason: `Sugestão ${suggestion.id} ${verb} (fonte: ${suggestion.source.name})`,
      sourceFileId: suggestion.source.fileId,
      sourceVersion: suggestion.source.versionOrHash,
      suggestionId: suggestion.id,
    });
    this.activities.addRef({
      activityId,
      fileId: suggestion.source.fileId,
      versionOrHash: suggestion.source.versionOrHash,
      location: suggestion.location,
      quote: suggestion.evidence,
      relationType,
      createdAt: timestamp,
    });
  }

  private assertValid(fields: ProposedFields, partial: boolean): ProposedFields {
    const schema = partial ? activityFieldsSchema.partial() : activityFieldsSchema;
    const parsed = schema.safeParse(fields);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const unknown = (parsed.data.ownerIds ?? []).filter((ownerId) => !this.members.get(ownerId));
    if (unknown.length > 0) throw new ValidationError(`Responsáveis desconhecidos: ${unknown.join(', ')}`);
    return parsed.data;
  }
}

function sameProposal(a: ProposedFields, b: ProposedFields): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ActivityFields>;
  return [...keys].every((key) => sameFieldValue(a[key], b[key]));
}
