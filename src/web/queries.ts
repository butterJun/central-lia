import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Activity,
  ActivityDetail,
  Conflict,
  Digest,
  Member,
  Onboarding,
  Source,
  Suggestion,
  SyncRun,
  SyncStatus,
} from '../shared/domain.ts';
import type { CreateActivityInput, DigestPeriod, ReviewSuggestionInput, UpdateActivityInput } from '../shared/schemas.ts';
import { api } from './api.ts';

/** All server state goes through TanStack Query: cached, refetched, and kept visible while offline. */

const SYNC_POLL_MS = 30_000;

export const keys = {
  members: ['members'] as const,
  activities: ['activities'] as const,
  activity: (id: string) => ['activities', id] as const,
  suggestions: (status: string) => ['suggestions', status] as const,
  syncStatus: ['sync-status'] as const,
  sources: ['sources'] as const,
  runs: ['sync-runs'] as const,
  conflicts: ['conflicts'] as const,
  digest: (memberId: string, period: DigestPeriod) => ['digest', memberId, period] as const,
  onboarding: (memberId: string) => ['onboarding', memberId] as const,
};

export const useMembers = () => useQuery({ queryKey: keys.members, queryFn: () => api<Member[]>('/api/members'), staleTime: Infinity });
export const useActivities = () => useQuery({ queryKey: keys.activities, queryFn: () => api<Activity[]>('/api/activities') });
export const useActivity = (id: string) =>
  useQuery({ queryKey: keys.activity(id), queryFn: () => api<ActivityDetail>(`/api/activities/${encodeURIComponent(id)}`) });
export const useSuggestions = (status: string) =>
  useQuery({ queryKey: keys.suggestions(status), queryFn: () => api<Suggestion[]>(`/api/suggestions${status ? `?status=${status}` : ''}`) });
export const useSyncStatus = () =>
  useQuery({ queryKey: keys.syncStatus, queryFn: () => api<SyncStatus>('/api/sync/status'), refetchInterval: SYNC_POLL_MS });
export const useSources = () => useQuery({ queryKey: keys.sources, queryFn: () => api<Source[]>('/api/sources'), refetchInterval: SYNC_POLL_MS });
export const useSyncRuns = () => useQuery({ queryKey: keys.runs, queryFn: () => api<SyncRun[]>('/api/sync/runs') });
export const useConflicts = () => useQuery({ queryKey: keys.conflicts, queryFn: () => api<Conflict[]>('/api/conflicts') });
export const useDigest = (memberId: string | null, period: DigestPeriod) =>
  useQuery({
    queryKey: keys.digest(memberId ?? '', period),
    queryFn: () => api<Digest>(`/api/digest?period=${period}`),
    enabled: Boolean(memberId),
  });
export const useOnboarding = (memberId: string | null) =>
  useQuery({ queryKey: keys.onboarding(memberId ?? ''), queryFn: () => api<Onboarding>('/api/onboarding'), enabled: Boolean(memberId) });

/** After any write, everything derived from activities/suggestions may have changed. */
function useInvalidateAll() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

export function useCreateActivity() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateActivityInput) => api<Activity>('/api/activities', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateActivity(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: UpdateActivityInput) => api<Activity>(`/api/activities/${encodeURIComponent(id)}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useReviewSuggestion(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: ReviewSuggestionInput) => api<Suggestion>(`/api/suggestions/${encodeURIComponent(id)}/review`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useRunSync() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => api<SyncStatus>('/api/sync/run', { method: 'POST' }), onSuccess: invalidate });
}

export function useResolveConflict() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, resolution }: { id: number; resolution: string }) =>
      api<Conflict>(`/api/conflicts/${id}/resolve`, { method: 'POST', body: { resolution } }),
    onSuccess: invalidate,
  });
}

export function useDisconnectDrive() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => api<SyncStatus>('/api/drive/disconnect', { method: 'POST' }), onSuccess: invalidate });
}

export function useNarrative(period: DigestPeriod) {
  return useMutation({
    mutationFn: () => api<{ text: string; generator: string; warning: string | null }>(`/api/digest/narrative?period=${period}`, { method: 'POST' }),
  });
}
