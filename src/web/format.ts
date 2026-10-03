import { daysBetween, formatDate, todayIso } from '../shared/dates.ts';
import {
  ACTIVITY_FIELD_LABELS,
  ACTIVITY_STATUS_LABELS,
  type ActivityField,
  type ActivityStatus,
  type FieldValue,
  type Member,
} from '../shared/domain.ts';

export type MemberNames = Map<string, Member>;

export function ownersText(ownerIds: string[], members: MemberNames, unresolved: string[] = []): string {
  const names = [...ownerIds.map((id) => members.get(id)?.displayName ?? id), ...unresolved.map((name) => `${name} (a confirmar)`)];
  return names.length > 0 ? names.join(' e ') : 'Responsável a confirmar';
}

/** Human description of a due date relative to today in São Paulo. */
export function dueDescription(dueDate: string | null, status: ActivityStatus): { label: string; tone: 'overdue' | 'soon' | 'normal' | 'none' } {
  if (!dueDate) return { label: 'Prazo a definir', tone: 'none' };
  const days = daysBetween(todayIso(), dueDate);
  const date = formatDate(dueDate);
  if (status === 'done') return { label: date, tone: 'normal' };
  if (days < 0) return { label: `${date} · vencida há ${-days} dia${days === -1 ? '' : 's'}`, tone: 'overdue' };
  if (days === 0) return { label: `${date} · vence hoje`, tone: 'soon' };
  if (days <= 3) return { label: `${date} · em ${days} dia${days === 1 ? '' : 's'}`, tone: 'soon' };
  return { label: date, tone: 'normal' };
}

export function fieldValueText(field: ActivityField, value: FieldValue | undefined, members: MemberNames): string {
  if (value === undefined || value === null || value === '') return field === 'dueDate' ? 'a definir' : '—';
  if (field === 'ownerIds' && Array.isArray(value)) return ownersText(value, members);
  if (field === 'status') return ACTIVITY_STATUS_LABELS[value as ActivityStatus] ?? String(value);
  if (field === 'dueDate') return formatDate(String(value));
  return Array.isArray(value) ? value.join(', ') : value;
}

export function fieldLabel(field: ActivityField): string {
  return ACTIVITY_FIELD_LABELS[field];
}
