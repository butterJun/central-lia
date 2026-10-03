import { isIsoDate } from '../../shared/dates.ts';

/**
 * Reads the lightweight metadata block used by the Liga's documents:
 *
 *   # Title
 *   status: ativo
 *   data_da_reuniao: 2026-10-03
 *
 * Google Docs exported to Markdown escape underscores (`data\_da\_reuniao`) and may
 * bold the keys; both forms are accepted.
 */

export interface DocumentMeta {
  title: string | null;
  fields: Record<string, string>;
  status: string | null;
  /** Most specific document date: meeting date, then update date, then creation date, then file name. */
  date: string | null;
}

export interface MarkdownSection {
  level: number;
  heading: string;
  body: string;
}

const META_LINE = /^\s*\**\s*([A-Za-z_\\]+)\s*\**\s*:\s*\**\s*(.+?)\s*$/;
const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const MAX_META_LINES = 15;
const DATE_KEYS = ['data_da_reuniao', 'atualizado_em', 'criado_em', 'data'];
const DEPRECATED_STATUSES = new Set(['deprecated', 'obsoleto', 'substituido', 'substituído', 'arquivado', 'historico', 'histórico']);

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([_*`#\-.])/g, '$1');
}

export function parseDocumentMeta(text: string, fileName = ''): DocumentMeta {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let title: string | null = null;
  const fields: Record<string, string> = {};
  let inspected = 0;

  for (const rawLine of lines) {
    if (inspected >= MAX_META_LINES) break;
    const line = unescapeMarkdown(rawLine);
    if (line.trim() === '') continue;
    inspected += 1;
    const heading = HEADING_LINE.exec(line);
    if (heading && title === null) {
      title = (heading[2] ?? '').trim();
      continue;
    }
    const meta = META_LINE.exec(line);
    if (meta) {
      fields[(meta[1] ?? '').toLowerCase()] = (meta[2] ?? '').replace(/\*+$/, '').trim();
      continue;
    }
    if (Object.keys(fields).length > 0) break;
  }

  const status = fields.status?.toLowerCase() ?? null;
  return { title, fields, status, date: pickDate(fields, fileName) };
}

function pickDate(fields: Record<string, string>, fileName: string): string | null {
  for (const key of DATE_KEYS) {
    const value = fields[key]?.slice(0, 10);
    if (value && isIsoDate(value)) return value;
  }
  const fromName = /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1];
  return fromName && isIsoDate(fromName) ? fromName : null;
}

export function isDeprecated(meta: DocumentMeta): boolean {
  return (meta.status !== null && DEPRECATED_STATUSES.has(meta.status)) || Boolean(meta.fields.substituido_por);
}

/** Splits Markdown into heading-delimited sections (text before the first heading has level 0). */
export function splitSections(text: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { level: 0, heading: '', body: '' };
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const heading = HEADING_LINE.exec(unescapeMarkdown(line));
    if (heading) {
      sections.push(current);
      current = { level: (heading[1] ?? '').length, heading: (heading[2] ?? '').trim(), body: '' };
    } else {
      current = { ...current, body: `${current.body}${line}\n` };
    }
  }
  sections.push(current);
  return sections.map((section) => ({ ...section, body: section.body.trim() })).filter((s) => s.heading || s.body);
}

/** Body text without the title and metadata lines. */
export function stripMetaBlock(text: string): string {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const result: string[] = [];
  let inHeader = true;
  for (const line of lines) {
    const clean = unescapeMarkdown(line);
    if (inHeader && (clean.trim() === '' || HEADING_LINE.test(clean) || META_LINE.test(clean))) continue;
    inHeader = false;
    result.push(line);
  }
  return result.join('\n').trim();
}
