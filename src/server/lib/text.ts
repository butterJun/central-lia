import { createHash } from 'node:crypto';

/** Lowercase, strip accents and collapse whitespace — for comparisons only. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove Markdown emphasis/code markers so quotes can be compared with plain text. */
export function stripInlineMarkdown(value: string): string {
  return value.replace(/\*\*|__|`/g, '');
}

/** Normalization used to check that an evidence quote really exists in a document. */
export function normalizeForEvidence(value: string): string {
  return normalizeForMatch(stripInlineMarkdown(value))
    .replace(/[“”"']/g, '')
    .replace(/^[-*•\s]+/, '')
    .replace(/[.;:\s]+$/, '');
}

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma',
  'para', 'por', 'com', 'sobre', 'ao', 'aos', 'que', 'se',
]);

export function contentTokens(value: string): Set<string> {
  const tokens = normalizeForMatch(value)
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
  return new Set(tokens);
}

/** Jaccard similarity of content words (0..1). */
export function tokenSimilarity(a: string, b: string): number {
  const left = contentTokens(a);
  const right = contentTokens(b);
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

/** True when two free-text values say essentially the same thing. */
export function isEquivalentText(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a ?? '';
  const right = b ?? '';
  if (normalizeForMatch(left) === normalizeForMatch(right)) return true;
  return tokenSimilarity(left, right) >= 0.8;
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function shortHash(value: string | Uint8Array): string {
  return sha256(value).slice(0, 16);
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
