import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { normalizeForMatch } from '../lib/text.ts';

/**
 * Minimal, namespace-agnostic .xlsx reader. It exists because spreadsheets
 * produced by the OpenXML SDK (like the case's registry) use prefixed tags
 * (`<x:workbook>`) and absolute relationship targets, which common libraries
 * fail to load. Only what this product needs is read: sheet names, header row,
 * cell text, and dates (number cells formatted as dates become ISO `YYYY-MM-DD`).
 */

export interface SheetTable {
  name: string;
  headers: string[];
  rows: SheetRow[];
}

export interface SheetRow {
  /** 1-based row number in the worksheet, for cell references like `Atividades!A2`. */
  rowNumber: number;
  cells: Record<string, string>;
}

const MAX_ROWS_PER_SHEET = 5000;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const EXCEL_EPOCH_1900_MS = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_1904_MS = Date.UTC(1904, 0, 1);
const MS_PER_DAY = 86_400_000;
const ARRAY_TAGS = new Set(['sheet', 'Relationship', 'si', 'r', 'row', 'c', 'numFmt', 'xf']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  textNodeName: '#text',
  isArray: (name) => ARRAY_TAGS.has(name),
});

type XmlNode = Record<string, unknown>;

interface WorkbookContext {
  sharedStrings: string[];
  dateStyles: Set<number>;
  date1904: boolean;
}

export class SpreadsheetFormatError extends Error {}

export async function readWorkbook(bytes: Buffer): Promise<SheetTable[]> {
  const zip = await JSZip.loadAsync(bytes);
  assertReasonableSize(zip);
  const workbook = (await readXml(zip, 'xl/workbook.xml')).workbook as XmlNode | undefined;
  if (!workbook) throw new SpreadsheetFormatError('Arquivo sem xl/workbook.xml');
  const targets = await readRelationshipTargets(zip);
  const context: WorkbookContext = {
    sharedStrings: await readSharedStrings(zip),
    dateStyles: await readDateStyles(zip),
    date1904: String(asNode(workbook.workbookPr)?.date1904 ?? '') === '1',
  };
  const sheets = asArray(asNode(workbook.sheets)?.sheet);
  const tables: SheetTable[] = [];
  for (const sheet of sheets) {
    const target = targets.get(String(sheet.id ?? ''));
    if (!target) continue;
    const document = await readXml(zip, target);
    tables.push(readSheet(String(sheet.name ?? 'Planilha'), asNode(document.worksheet), context));
  }
  return tables;
}

/** Bytes each workbook may still inflate; header sizes are attacker-controlled, so real output is counted. */
const inflateBudget = new WeakMap<JSZip, { remaining: number }>();

function assertReasonableSize(zip: JSZip): void {
  if (Object.keys(zip.files).length > MAX_ZIP_ENTRIES) throw new SpreadsheetFormatError('Planilha com arquivos internos demais');
  inflateBudget.set(zip, { remaining: MAX_UNCOMPRESSED_BYTES });
}

async function readXml(zip: JSZip, path: string): Promise<XmlNode> {
  const entry = zip.file(path.replace(/^\//, ''));
  if (!entry) return {};
  const budget = inflateBudget.get(zip) ?? { remaining: MAX_UNCOMPRESSED_BYTES };
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    stream.on('data', (chunk: Buffer) => {
      budget.remaining -= chunk.length;
      if (budget.remaining < 0) {
        stream.pause();
        reject(new SpreadsheetFormatError('Planilha grande demais para este protótipo'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  const text = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
  return parser.parse(text) as XmlNode;
}

async function readRelationshipTargets(zip: JSZip): Promise<Map<string, string>> {
  const rels = asNode((await readXml(zip, 'xl/_rels/workbook.xml.rels')).Relationships);
  const targets = new Map<string, string>();
  for (const rel of asArray(rels?.Relationship)) {
    const target = String(rel.Target ?? '');
    targets.set(String(rel.Id ?? ''), target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  return targets;
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const sst = asNode((await readXml(zip, 'xl/sharedStrings.xml')).sst);
  return asArray(sst?.si).map(richText);
}

async function readDateStyles(zip: JSZip): Promise<Set<number>> {
  const styleSheet = asNode((await readXml(zip, 'xl/styles.xml')).styleSheet);
  const customDateFormats = new Set(
    asArray(asNode(styleSheet?.numFmts)?.numFmt)
      .filter((format) => isDateFormatCode(String(format.formatCode ?? '')))
      .map((format) => Number(format.numFmtId)),
  );
  const dateStyles = new Set<number>();
  asArray(asNode(styleSheet?.cellXfs)?.xf).forEach((xf, index) => {
    const formatId = Number(xf.numFmtId ?? 0);
    if (BUILTIN_DATE_FORMATS.has(formatId) || customDateFormats.has(formatId)) dateStyles.add(index);
  });
  return dateStyles;
}

function isDateFormatCode(code: string): boolean {
  const withoutLiterals = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dy]/i.test(withoutLiterals);
}

function readSheet(name: string, worksheet: XmlNode | undefined, context: WorkbookContext): SheetTable {
  const rows = asArray(asNode(worksheet?.sheetData)?.row);
  const grid = rows.slice(0, MAX_ROWS_PER_SHEET + 1).map((row) => ({
    rowNumber: Number(row.r ?? 0),
    values: readRowValues(row, context),
  }));
  const headerRow = grid.find((row) => row.rowNumber === 1) ?? grid[0];
  const headerValues = headerRow?.values ?? [];
  const headers = headerValues.map((value) => value.trim());
  const dataRows = grid
    .filter((row) => row !== headerRow)
    .map((row) => ({
      rowNumber: row.rowNumber,
      cells: Object.fromEntries(headers.flatMap((header, index) => (header ? [[header, (row.values[index] ?? '').trim()]] : []))),
    }))
    .filter((row) => Object.values(row.cells).some((value) => value !== ''));
  return { name, headers: headers.filter(Boolean), rows: dataRows };
}

function readRowValues(row: XmlNode, context: WorkbookContext): string[] {
  const values: string[] = [];
  asArray(row.c).forEach((cell, position) => {
    const column = cell.r ? columnIndex(String(cell.r)) : position;
    values[column] = cellText(cell, context);
  });
  return Array.from(values, (value) => value ?? '');
}

function cellText(cell: XmlNode, context: WorkbookContext): string {
  const type = String(cell.t ?? 'n');
  const raw = textOf(cell.v);
  switch (type) {
    case 's':
      return context.sharedStrings[Number(raw)] ?? '';
    case 'inlineStr':
      return richText(asNode(cell.is) ?? {});
    case 'b':
      return raw === '1' ? 'VERDADEIRO' : 'FALSO';
    case 'e':
      return '';
    case 'str':
      return raw;
    default:
      return context.dateStyles.has(Number(cell.s ?? -1)) && raw !== '' ? serialToIsoDate(Number(raw), context.date1904) : raw;
  }
}

/** Excel serial date → `YYYY-MM-DD` (time of day is dropped; due dates are calendar dates). */
export function serialToIsoDate(serial: number, date1904 = false): string {
  if (!Number.isFinite(serial)) return '';
  const epoch = date1904 ? EXCEL_EPOCH_1904_MS : EXCEL_EPOCH_1900_MS;
  return new Date(epoch + Math.floor(serial) * MS_PER_DAY).toISOString().slice(0, 10);
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0]?.toUpperCase() ?? 'A';
  return [...letters].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
}

function richText(node: XmlNode): string {
  if (node.t !== undefined) return textOf(node.t);
  return asArray(node.r)
    .map((run) => textOf(run.t))
    .join('');
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return textOf((value as XmlNode)['#text']);
  return String(value);
}

function asNode(value: unknown): XmlNode | undefined {
  return value && typeof value === 'object' ? (value as XmlNode) : undefined;
}

function asArray(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value.filter((item): item is XmlNode => Boolean(item) && typeof item === 'object');
  const node = asNode(value);
  return node ? [node] : [];
}

/** Plain-text rendering kept as the processed copy of a spreadsheet. */
export function workbookToText(tables: SheetTable[]): string {
  return tables
    .map((table) => {
      const header = `## Aba ${table.name}\n\n| ${table.headers.join(' | ')} |`;
      const body = table.rows.map((row) => `| ${table.headers.map((h) => row.cells[h] ?? '').join(' | ')} |`);
      return [header, ...body].join('\n');
    })
    .join('\n\n');
}

/** Finds a header by normalized name among several accepted spellings. */
export function findHeader(headers: string[], candidates: readonly string[]): string | undefined {
  const wanted = candidates.map(normalizeForMatch);
  return headers.find((header) => wanted.includes(normalizeForMatch(header)));
}

export const REGISTRY_COLUMNS = {
  id: ['ID', 'Código', 'Codigo'],
  title: ['Atividade', 'Título', 'Titulo', 'Tarefa'],
  owners: ['Responsáveis', 'Responsavel', 'Responsável', 'Responsaveis', 'Dono'],
  dueDate: ['Prazo', 'Data limite', 'Vencimento'],
  front: ['Frente', 'Área', 'Area'],
  priority: ['Prioridade'],
  status: ['Status', 'Estado', 'Situação', 'Situacao'],
  nextStep: ['Próximo passo', 'Proximo passo'],
  origin: ['Origem', 'Fonte'],
  notes: ['Notas e bloqueios', 'Notas', 'Observações', 'Observacoes', 'Bloqueios'],
} as const;

/** A table "looks like" an activity registry when it has at least ID and activity columns. */
export function looksLikeActivityRegistry(table: SheetTable): boolean {
  return Boolean(findHeader(table.headers, REGISTRY_COLUMNS.id) && findHeader(table.headers, REGISTRY_COLUMNS.title));
}
