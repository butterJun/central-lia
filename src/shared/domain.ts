/**
 * Domain vocabulary shared by the API server and the web client.
 * Values are stable identifiers; labels are the Portuguese text shown in the UI.
 */

export const ACTIVITY_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  todo: 'A fazer',
  in_progress: 'Em andamento',
  blocked: 'Bloqueada',
  done: 'Concluída',
};

export const SUGGESTION_STATUSES = ['pending', 'accepted', 'adjusted', 'rejected', 'superseded'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  pending: 'Pendente',
  accepted: 'Aceita',
  adjusted: 'Ajustada',
  rejected: 'Rejeitada',
  superseded: 'Substituída (o documento mudou)',
};

export const SUGGESTION_KINDS = ['create', 'update'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const SOURCE_SYNC_STATUSES = ['processed', 'failed', 'ignored', 'unsupported', 'unavailable'] as const;
export type SourceSyncStatus = (typeof SOURCE_SYNC_STATUSES)[number];
export const SOURCE_SYNC_STATUS_LABELS: Record<SourceSyncStatus, string> = {
  processed: 'Processado',
  failed: 'Falhou',
  ignored: 'Ignorado',
  unsupported: 'Formato ainda não processado',
  unavailable: 'Indisponível',
};

/** How a source participates in the product, decided by the authority rules. */
export const SOURCE_ROLES = ['registry', 'shadow_registry', 'direction', 'minutes', 'historical', 'other'] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];
export const SOURCE_ROLE_LABELS: Record<SourceRole, string> = {
  registry: 'Registro inicial de atividades (indicado pelo índice)',
  shadow_registry: 'Planilha sem autoridade (não altera atividades)',
  direction: 'Documento de direção',
  minutes: 'Ata ou documento analisado pela IA',
  historical: 'Histórico (substituído)',
  other: 'Outro arquivo',
};

export const MEMBER_ROLES = ['member', 'reviewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface Member {
  id: string;
  displayName: string;
  front: string;
  role: MemberRole;
  description: string;
}

export const ACTIVITY_FIELDS = ['title', 'description', 'nextStep', 'ownerIds', 'front', 'status', 'dueDate'] as const;
export type ActivityField = (typeof ACTIVITY_FIELDS)[number];
export const ACTIVITY_FIELD_LABELS: Record<ActivityField, string> = {
  title: 'Título',
  description: 'Descrição',
  nextStep: 'Próximo passo',
  ownerIds: 'Responsáveis',
  front: 'Frente',
  status: 'Estado',
  dueDate: 'Prazo',
};

export type ActivityOrigin = 'import' | 'manual' | 'suggestion';

/** Fields of an activity that people (or reviewed suggestions) may change. */
export interface ActivityFields {
  title: string;
  description: string;
  nextStep: string;
  ownerIds: string[];
  front: string;
  status: ActivityStatus;
  dueDate: string | null;
}
export type ProposedFields = Partial<ActivityFields>;

export type FieldValue = string | string[] | null;
export interface FieldChange {
  field: ActivityField;
  before: FieldValue;
  after: FieldValue;
}

export interface SourceLink {
  fileId: string;
  name: string;
  webUrl: string;
  syncStatus: SourceSyncStatus;
}

export interface ActivityRef {
  source: SourceLink;
  versionOrHash: string;
  location: string;
  quote: string;
  relationType: 'imported_from' | 'updated_by' | 'created_by';
  createdAt: string;
}

export interface ActivityEvent {
  id: number;
  activityId: string;
  actorId: string;
  actorName: string;
  timestamp: string;
  kind: 'imported' | 'created' | 'updated' | 'suggestion_applied';
  changes: FieldChange[];
  reason: string | null;
  source: SourceLink | null;
  suggestionId: string | null;
}

export interface Activity extends ActivityFields {
  id: string;
  unresolvedOwners: string[];
  priority: string | null;
  notes: string | null;
  origin: ActivityOrigin;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  version: number;
  pendingSuggestionIds: string[];
  refs: ActivityRef[];
}

export interface ActivityDetail extends Activity {
  events: ActivityEvent[];
}

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  targetActivityId: string | null;
  targetActivityTitle: string | null;
  proposed: ProposedFields;
  baseline: ProposedFields;
  evidence: string;
  location: string;
  reason: string;
  uncertainties: string[];
  generator: string;
  status: SuggestionStatus;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  appliedFields: ProposedFields | null;
  resultActivityId: string | null;
  possibleDuplicateOf: string | null;
  createdAt: string;
  source: SourceLink & { versionOrHash: string; docDate: string | null };
}

export interface IgnoredItem {
  text: string;
  reason: string;
}

export interface SourceAnalysis {
  generator: string;
  analyzedVersion: string;
  /** Hash of the analyzed text: a new Drive version with identical text is not re-analyzed. */
  contentHash: string;
  /** The preferred analyzer failed and the rule-based fallback was used: analyze again next run. */
  degraded: boolean;
  suggestionsCreated: number;
  ignored: IgnoredItem[];
  warnings: string[];
}

export interface Source {
  fileId: string;
  name: string;
  mimeType: string;
  kindLabel: string;
  webUrl: string;
  modifiedAt: string;
  versionOrHash: string;
  path: string;
  syncStatus: SourceSyncStatus;
  statusDetail: string | null;
  role: SourceRole;
  docStatus: string | null;
  docDate: string | null;
  lastProcessedAt: string | null;
  lastSeenAt: string;
  analysis: SourceAnalysis | null;
}

export type SyncTrigger = 'auto' | 'manual' | 'startup';
export type SyncRunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface SyncRunStats {
  listed: number;
  processed: number;
  unchanged: number;
  failed: number;
  ignored: number;
  unsupported: number;
  unavailable: number;
  suggestionsCreated: number;
}

export interface SyncRun {
  id: number;
  trigger: SyncTrigger;
  startedAt: string;
  finishedAt: string | null;
  status: SyncRunStatus;
  stats: SyncRunStats | null;
  error: string | null;
}

export const CONFLICT_KINDS = [
  'shadow_registry',
  'registry_row_removed',
  'registry_empty',
  'registry_ambiguous',
  'conflicting_suggestions',
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export interface Conflict {
  id: number;
  kind: ConflictKind;
  source: SourceLink | null;
  description: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface RegistryInfo {
  source: SourceLink;
  sheet: string;
  importedAt: string;
  importedVersion: string;
  lastComparedVersion: string;
  pointerFrom: string;
}

export interface SyncStatus {
  mode: 'google' | 'local';
  connected: boolean;
  needsAuth: boolean;
  folder: { id: string; name: string; webUrl: string } | null;
  intervalSeconds: number;
  running: boolean;
  lastRun: SyncRun | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  stale: boolean;
  counts: Record<SourceSyncStatus, number>;
  registry: RegistryInfo | null;
  ai: { provider: 'claude' | 'heuristic'; model: string | null; detail: string };
  openConflicts: number;
}

export interface ActivitySummary {
  id: string;
  title: string;
  dueDate: string | null;
  status: ActivityStatus;
  ownerIds: string[];
  hasPendingSuggestion: boolean;
}

export interface DigestChange {
  activityId: string;
  activityTitle: string;
  timestamp: string;
  actorName: string;
  kind: ActivityEvent['kind'];
  changes: FieldChange[];
  reason: string | null;
  source: SourceLink | null;
}

export interface DigestNote {
  text: string;
  activityId: string | null;
  source: SourceLink | null;
}

export interface Digest {
  memberId: string;
  since: string;
  generatedAt: string;
  confirmed: DigestChange[];
  pending: Suggestion[];
  overdue: ActivitySummary[];
  dueSoon: ActivitySummary[];
  blocked: ActivitySummary[];
  uncertain: DigestNote[];
  documents: Array<Pick<Source, 'fileId' | 'name' | 'webUrl' | 'syncStatus' | 'lastProcessedAt' | 'role'>>;
  nothingChanged: boolean;
}

export interface OnboardingDocument {
  source: SourceLink;
  description: string;
  docStatus: string | null;
  updatedAt: string | null;
  partial: boolean;
}

export interface Onboarding {
  purpose: { markdown: string; partial: boolean; source: SourceLink } | null;
  fronts: { markdown: string; source: SourceLink } | null;
  steps: { markdown: string; source: SourceLink } | null;
  documents: OnboardingDocument[];
  historical: Array<{ source: SourceLink; supersededBy: string | null }>;
  registry: RegistryInfo | null;
  precedenceRule: string;
  firstAction: ActivitySummary | null;
  gaps: string[];
}
