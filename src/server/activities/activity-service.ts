import {
  ACTIVITY_FIELDS,
  type Activity,
  type ActivityDetail,
  type ActivityFields,
  type FieldChange,
  type FieldValue,
  type ProposedFields,
} from '../../shared/domain.ts';
import type { CreateActivityInput, UpdateActivityInput } from '../../shared/schemas.ts';
import { nowIso, transaction, type Db } from '../db/database.ts';
import { ValidationError } from '../lib/errors.ts';
import type { ActivitiesRepo } from '../repositories/activities-repo.ts';
import type { MembersRepo } from '../repositories/members-repo.ts';

/** Compares two field values; owner lists are compared as sets. */
export function sameFieldValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = [...(Array.isArray(a) ? a : [])].sort();
    const right = [...(Array.isArray(b) ? b : [])].sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return (a ?? null) === (b ?? null);
}

/** Field-by-field difference between the current activity and proposed values. */
export function diffFields(current: ActivityFields, next: ProposedFields): FieldChange[] {
  return ACTIVITY_FIELDS.flatMap((field) => {
    if (!(field in next)) return [];
    const before = current[field] as FieldValue;
    const after = next[field] as FieldValue;
    return sameFieldValue(before, after) ? [] : [{ field, before, after }];
  });
}

export function pickFields(activity: Activity): ActivityFields {
  return {
    title: activity.title,
    description: activity.description,
    nextStep: activity.nextStep,
    ownerIds: activity.ownerIds,
    front: activity.front,
    status: activity.status,
    dueDate: activity.dueDate,
  };
}

/** Manual activity management from the UI. Every change leaves an auditable event. */
export class ActivityService {
  constructor(
    private readonly db: Db,
    private readonly activities: ActivitiesRepo,
    private readonly members: MembersRepo,
  ) {}

  list(): Activity[] {
    return this.activities.list();
  }

  detail(id: string): ActivityDetail {
    return { ...this.activities.require(id), events: this.activities.listEvents(id) };
  }

  create(input: CreateActivityInput, actorId: string): Activity {
    this.assertOwnersExist(input.ownerIds);
    return transaction(this.db, () => {
      const id = this.activities.nextId();
      const now = nowIso();
      const fields: ActivityFields = { ...input, ownerIds: [...new Set(input.ownerIds)] };
      this.activities.insert({
        ...fields,
        id,
        priority: null,
        notes: null,
        unresolvedOwners: [],
        origin: 'manual',
        createdBy: actorId,
        createdAt: now,
      });
      const changes = ACTIVITY_FIELDS.map((field) => ({ field, before: null, after: fields[field] as FieldValue }));
      this.activities.addEvent({
        activityId: id,
        actorId,
        timestamp: now,
        kind: 'created',
        changes: changes.filter((change) => !sameFieldValue(change.after, null) && !sameFieldValue(change.after, '')),
        reason: 'Criada manualmente na interface',
        sourceFileId: null,
        sourceVersion: null,
        suggestionId: null,
      });
      return this.activities.require(id);
    });
  }

  update(id: string, input: UpdateActivityInput, actorId: string): Activity {
    const { expectedVersion, reason, ...fields } = input;
    if (fields.ownerIds) this.assertOwnersExist(fields.ownerIds);
    return transaction(this.db, () => {
      const current = this.activities.require(id);
      const changes = diffFields(pickFields(current), fields);
      if (changes.length === 0) return current;
      const changedFields = Object.fromEntries(changes.map((change) => [change.field, change.after])) as ProposedFields;
      const now = nowIso();
      this.activities.applyFields(id, changedFields, expectedVersion, now);
      this.activities.addEvent({
        activityId: id,
        actorId,
        timestamp: now,
        kind: 'updated',
        changes,
        reason: reason?.trim() || 'Editada na interface',
        sourceFileId: null,
        sourceVersion: null,
        suggestionId: null,
      });
      return this.activities.require(id);
    });
  }

  private assertOwnersExist(ownerIds: string[]): void {
    const unknown = ownerIds.filter((ownerId) => !this.members.get(ownerId));
    if (unknown.length > 0) throw new ValidationError(`Responsáveis desconhecidos: ${unknown.join(', ')}`);
  }
}
