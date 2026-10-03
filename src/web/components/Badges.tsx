import {
  ACTIVITY_STATUS_LABELS,
  SOURCE_SYNC_STATUS_LABELS,
  SUGGESTION_STATUS_LABELS,
  type ActivityStatus,
  type SourceSyncStatus,
  type SuggestionStatus,
} from '../../shared/domain.ts';
import { dueDescription } from '../format.ts';

/** Every badge carries a symbol and a word, so state never depends on color alone. */

const ACTIVITY_STYLE: Record<ActivityStatus, { className: string; symbol: string }> = {
  todo: { className: 'badge-todo', symbol: '○' },
  in_progress: { className: 'badge-progress', symbol: '◐' },
  blocked: { className: 'badge-blocked', symbol: '⛔' },
  done: { className: 'badge-done', symbol: '✓' },
};

export function ActivityStatusBadge({ status }: { status: ActivityStatus }) {
  const style = ACTIVITY_STYLE[status];
  return (
    <span className={`badge ${style.className}`}>
      <span aria-hidden="true">{style.symbol}</span>
      {ACTIVITY_STATUS_LABELS[status]}
    </span>
  );
}

const SUGGESTION_STYLE: Record<SuggestionStatus, { className: string; symbol: string }> = {
  pending: { className: 'badge-warn', symbol: '…' },
  accepted: { className: 'badge-done', symbol: '✓' },
  adjusted: { className: 'badge-done', symbol: '✎' },
  rejected: { className: 'badge-blocked', symbol: '✕' },
  superseded: { className: 'badge-todo', symbol: '↻' },
};

export function SuggestionStatusBadge({ status }: { status: SuggestionStatus }) {
  const style = SUGGESTION_STYLE[status];
  return (
    <span className={`badge ${style.className}`}>
      <span aria-hidden="true">{style.symbol}</span>
      {SUGGESTION_STATUS_LABELS[status]}
    </span>
  );
}

const SOURCE_STYLE: Record<SourceSyncStatus, { className: string; symbol: string }> = {
  processed: { className: 'badge-done', symbol: '✓' },
  failed: { className: 'badge-blocked', symbol: '⚠' },
  ignored: { className: 'badge-todo', symbol: '–' },
  unsupported: { className: 'badge-warn', symbol: '◇' },
  unavailable: { className: 'badge-blocked', symbol: '✕' },
};

export function SourceStatusBadge({ status }: { status: SourceSyncStatus }) {
  const style = SOURCE_STYLE[status];
  return (
    <span className={`badge ${style.className}`}>
      <span aria-hidden="true">{style.symbol}</span>
      {SOURCE_SYNC_STATUS_LABELS[status]}
    </span>
  );
}

export function PendingUpdateBadge() {
  return (
    <span className="badge badge-warn">
      <span aria-hidden="true">⚑</span>Atualização pendente
    </span>
  );
}

export function DueDate({ dueDate, status }: { dueDate: string | null; status: ActivityStatus }) {
  const { label, tone } = dueDescription(dueDate, status);
  return <span className={`due-${tone}`}>{label}</span>;
}
