import { addDaysIso, daysBetween, todayIso } from '../../shared/dates.ts';
import type { Activity, ActivitySummary, Digest, DigestChange, DigestNote, Suggestion } from '../../shared/domain.ts';
import type { DigestPeriod } from '../../shared/schemas.ts';
import type { ActivitiesRepo } from '../repositories/activities-repo.ts';
import type { ConflictsRepo } from '../repositories/conflicts-repo.ts';
import type { MembersRepo } from '../repositories/members-repo.ts';
import type { SourcesRepo } from '../repositories/sources-repo.ts';
import type { SuggestionsRepo } from '../repositories/suggestions-repo.ts';

const DUE_SOON_DAYS = 3;
const MAX_DOCUMENTS = 10;
const BEGINNING_OF_TIME = '1970-01-01T00:00:00.000Z';

export function toSummary(activity: Activity): ActivitySummary {
  return {
    id: activity.id,
    title: activity.title,
    dueDate: activity.dueDate,
    status: activity.status,
    ownerIds: activity.ownerIds,
    hasPendingSuggestion: activity.pendingSuggestionIds.length > 0,
  };
}

/**
 * "What changed for me": built only from records (events, pending suggestions,
 * activities, sources). Confirmed facts, pending proposals and uncertain data
 * are kept in separate lists so the UI never mixes them.
 */
export class DigestService {
  constructor(
    private readonly activities: ActivitiesRepo,
    private readonly suggestions: SuggestionsRepo,
    private readonly sources: SourcesRepo,
    private readonly members: MembersRepo,
    private readonly conflicts: ConflictsRepo,
  ) {}

  build(memberId: string, period: DigestPeriod, now: Date = new Date()): Digest {
    this.members.require(memberId);
    const since = this.resolveSince(memberId, period, now);
    const today = todayIso(now);
    const all = this.activities.list();
    const mine = all.filter((activity) => activity.ownerIds.includes(memberId));
    const mineIds = new Set(mine.map((activity) => activity.id));
    const open = mine.filter((activity) => activity.status !== 'done');
    const confirmed = this.confirmedChanges(since, memberId, mineIds, all);
    const pending = this.suggestions
      .list(['pending'])
      .filter((s) => (s.targetActivityId && mineIds.has(s.targetActivityId)) || s.proposed.ownerIds?.includes(memberId));
    const documents = this.sources
      .list()
      .filter((source) => source.lastProcessedAt && source.lastProcessedAt > since)
      .sort((a, b) => (b.lastProcessedAt ?? '').localeCompare(a.lastProcessedAt ?? ''))
      .slice(0, MAX_DOCUMENTS)
      .map(({ fileId, name, webUrl, syncStatus, lastProcessedAt, role }) => ({ fileId, name, webUrl, syncStatus, lastProcessedAt, role }));

    return {
      memberId,
      since,
      generatedAt: now.toISOString(),
      confirmed,
      pending,
      overdue: open.filter((a) => a.dueDate !== null && a.dueDate < today).map(toSummary),
      dueSoon: open
        .filter((a) => a.dueDate !== null && a.dueDate >= today && daysBetween(today, a.dueDate) <= DUE_SOON_DAYS)
        .map(toSummary),
      blocked: open.filter((a) => a.status === 'blocked').map(toSummary),
      uncertain: this.uncertainNotes(open, pending),
      documents,
      nothingChanged: confirmed.length === 0 && pending.length === 0 && documents.length === 0,
    };
  }

  private resolveSince(memberId: string, period: DigestPeriod, now: Date): string {
    if (period === 'all') return BEGINNING_OF_TIME;
    if (period === '7d' || period === '30d') {
      return `${addDaysIso(todayIso(now), period === '7d' ? -7 : -30)}T00:00:00.000Z`;
    }
    return this.members.previousVisit(memberId) ?? BEGINNING_OF_TIME;
  }

  /** Events on my activities, plus events where I gained or lost ownership. */
  private confirmedChanges(since: string, memberId: string, mineIds: Set<string>, all: Activity[]): DigestChange[] {
    const titles = new Map(all.map((activity) => [activity.id, activity.title]));
    return this.activities
      .listEventsSince(since)
      .filter(
        (event) =>
          mineIds.has(event.activityId) ||
          event.changes.some(
            (change) => change.field === 'ownerIds' && [change.before, change.after].some((value) => Array.isArray(value) && value.includes(memberId)),
          ),
      )
      .map((event) => ({
        activityId: event.activityId,
        activityTitle: titles.get(event.activityId) ?? event.activityId,
        timestamp: event.timestamp,
        actorName: event.actorName,
        kind: event.kind,
        changes: event.changes,
        reason: event.reason,
        source: event.source,
      }));
  }

  private uncertainNotes(open: Activity[], pending: Suggestion[]): DigestNote[] {
    const notes: DigestNote[] = [];
    for (const activity of open) {
      if (!activity.dueDate) notes.push({ text: `${activity.id} não tem prazo definido.`, activityId: activity.id, source: null });
      if (activity.unresolvedOwners.length > 0) {
        notes.push({ text: `${activity.id}: responsável a confirmar (${activity.unresolvedOwners.join(', ')}).`, activityId: activity.id, source: null });
      }
      for (const ref of activity.refs.filter((r) => r.source.syncStatus === 'unavailable' || r.source.syncStatus === 'failed')) {
        notes.push({
          text: `${activity.id}: a fonte ${ref.source.name} está ${ref.source.syncStatus === 'failed' ? 'com erro de leitura' : 'indisponível'}; a informação pode estar desatualizada.`,
          activityId: activity.id,
          source: ref.source,
        });
      }
    }
    for (const suggestion of pending) {
      for (const uncertainty of suggestion.uncertainties) {
        notes.push({ text: `Sugestão ${suggestion.id}: ${uncertainty}`, activityId: suggestion.targetActivityId, source: suggestion.source });
      }
    }
    for (const conflict of this.conflicts.list().filter((c) => c.status === 'open')) {
      notes.push({ text: `Conflito em aberto: ${conflict.description}`, activityId: null, source: conflict.source });
    }
    return notes;
  }
}
