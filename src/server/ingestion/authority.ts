import type { SourceRole } from '../../shared/domain.ts';
import { normalizeForMatch } from '../lib/text.ts';
import { isDeprecated, type DocumentMeta } from './frontmatter.ts';

/**
 * Authority rules: which file is the official initial activity registry, and
 * what role every other document plays. The index document (INDEX.md) is the
 * authority that names the registry; a similar-looking spreadsheet never is.
 */

export interface RegistryPointer {
  fileName: string;
  sheet: string | null;
  declaredIn: string;
}

export interface TextDocument {
  name: string;
  text: string;
}

const INDEX_NAME = /^(index|indice|índice)\b/i;
const BACKTICK_XLSX = /`([^`]+\.xlsx)`/i;
const PLAIN_XLSX = /([\p{L}\p{N}_\-. ]+\.xlsx)/iu;
const SHEET_NAME = /aba\s+[`"“]?([\p{L}\p{N} _-]+?)[`"”]?(?=[\s,:;.)]|$)/iu;

export function isIndexDocument(name: string): boolean {
  return INDEX_NAME.test(name.replace(/\.[^.]+$/, ''));
}

/**
 * Finds the spreadsheet declared as the activity source, e.g.
 * "- `Ata_registro.xlsx`, aba `Atividades`: **fonte inicial ... das atividades**".
 * Index documents are searched first.
 */
export function findRegistryPointer(documents: TextDocument[]): RegistryPointer | null {
  const ordered = [...documents].sort((a, b) => Number(isIndexDocument(b.name)) - Number(isIndexDocument(a.name)));
  for (const document of ordered) {
    const pointer = findPointerInText(document);
    if (pointer) return pointer;
  }
  return null;
}

function findPointerInText(document: TextDocument): RegistryPointer | null {
  const lines = document.text.replace(/\\_/g, '_').split(/\r?\n/);
  const candidates = lines.filter((line) => /\.xlsx/i.test(line) && /fonte/i.test(line));
  const best = candidates.find((line) => /ativid/i.test(line)) ?? candidates[0];
  if (!best) return null;
  const fileName = (BACKTICK_XLSX.exec(best)?.[1] ?? PLAIN_XLSX.exec(best)?.[1] ?? '').trim();
  if (!fileName) return null;
  const sheet = SHEET_NAME.exec(best)?.[1]?.trim() ?? null;
  return { fileName, sheet, declaredIn: document.name };
}

/** File names quoted with backticks in the index (the documents it vouches for). */
export function namesListedInIndex(indexText: string): Set<string> {
  const names = new Set<string>();
  for (const match of indexText.matchAll(/`([^`]+\.(?:md|xlsx|pdf|docx|gdoc))`/gi)) {
    names.add(normalizeForMatch(match[1] ?? ''));
  }
  return names;
}

export function sameFileName(a: string, b: string): boolean {
  const strip = (value: string) => normalizeForMatch(value).replace(/\.xlsx$/, '');
  return strip(a) === strip(b);
}

/** Role of a text document. Minutes and unknown text documents are analyzed for suggestions. */
export function classifyTextDocument(name: string, meta: DocumentMeta, listedInIndex: Set<string>): SourceRole {
  if (isDeprecated(meta)) return 'historical';
  const isMeeting = Boolean(meta.fields.data_da_reuniao) || /^ata\b/i.test(name);
  if (isMeeting) return 'minutes';
  if (isIndexDocument(name) || listedInIndex.has(normalizeForMatch(name))) return 'direction';
  return 'minutes';
}
