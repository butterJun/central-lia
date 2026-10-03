/**
 * Date helpers. Due dates are calendar dates stored as ISO `YYYY-MM-DD`;
 * "today" is always evaluated in the Liga's time zone (America/Sao_Paulo).
 */

export const APP_TIME_ZONE = 'America/Sao_Paulo';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

/** Today's calendar date in São Paulo, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(isoToUtcMs(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is in the past). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((isoToUtcMs(toIso) - isoToUtcMs(fromIso)) / MS_PER_DAY);
}

/** `2026-10-07` → `07/10/2026`. Returns the input unchanged when it is not an ISO date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return iso ?? '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Timestamp rendered in São Paulo time, e.g. `03/10/2026 14:05`. */
export function formatDateTime(timestamp: string | null | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
