import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { AppConfig } from '../src/server/config.ts';
import { createContainer, type Container, type ContainerOverrides } from '../src/server/container.ts';

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../fixtures/drive');
export const INITIAL_LOAD_DIR = path.join(FIXTURES_DIR, '01_CARGA_INICIAL');
export const LATER_DIR = path.join(FIXTURES_DIR, '02_ADICIONAR_DEPOIS_DA_CARGA');
export const CONFLICT_DIR = path.join(FIXTURES_DIR, '03_CONFLITO');

export function readFixture(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

/** Creates an empty temporary folder that plays the role of the Drive root. */
export function makeTempDir(prefix = 'central-lia-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function copyFixture(fromDir: string, name: string, toDir: string, newName = name): string {
  const target = path.join(toDir, newName);
  fs.copyFileSync(path.join(fromDir, name), target);
  return target;
}

export function copyInitialLoad(toDir: string): void {
  for (const name of fs.readdirSync(INITIAL_LOAD_DIR)) copyFixture(INITIAL_LOAD_DIR, name, toDir);
}

/** Writes a file and bumps its mtime so the local gateway sees a new version even within the same millisecond. */
export function writeFileBumped(file: string, content: string | Buffer): void {
  fs.writeFileSync(file, content);
  const future = new Date(Date.now() + Math.floor(Math.random() * 100_000) + 1000);
  fs.utimesSync(file, future, future);
}

/** Minimal single-page PDF with selectable text (computes the xref offsets). */
export function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export interface TestWorld {
  container: Container;
  driveDir: string;
  databaseFile: string;
  /** Simulates restarting the application on the same database. */
  restart(): Container;
}

export function testConfig(driveDir: string, databaseFile: string): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    databaseFile,
    driveMode: 'local',
    localDriveDir: driveDir,
    google: null,
    appSecret: null,
    syncIntervalSeconds: 60,
    ai: { provider: 'heuristic', model: 'test', reason: 'testes', apiKey: null },
    registryFileNameFallback: null,
    webDistDir: path.join(driveDir, '__no_web__'),
    membersFile: path.resolve(import.meta.dirname, '../config/members.json'),
    demo: false,
  };
}

/** `overrides` may be a function of the Drive folder, to build a custom gateway on it. */
export function createTestWorld(
  overridesOrFactory: ContainerOverrides | ((driveDir: string) => ContainerOverrides) = {},
): TestWorld {
  const root = makeTempDir();
  const driveDir = path.join(root, 'drive');
  fs.mkdirSync(driveDir);
  const databaseFile = path.join(root, 'test.sqlite');
  const overrides = typeof overridesOrFactory === 'function' ? overridesOrFactory(driveDir) : overridesOrFactory;
  const world: TestWorld = {
    container: createContainer(testConfig(driveDir, databaseFile), overrides),
    driveDir,
    databaseFile,
    restart() {
      world.container.close();
      world.container = createContainer(testConfig(driveDir, databaseFile), overrides);
      return world.container;
    },
  };
  return world;
}

/** World with the initial load (01_CARGA_INICIAL) already synchronized. */
export async function createLoadedWorld(overrides: ContainerOverrides = {}): Promise<TestWorld> {
  const world = createTestWorld(overrides);
  copyInitialLoad(world.driveDir);
  await world.container.sync.run('manual');
  return world;
}

export interface XlsxRow {
  [header: string]: string | { date: string };
}

/** Writes a conventional (unprefixed) .xlsx with inline strings and real date cells. */
export async function makeXlsx(sheetName: string, headers: string[], rows: XlsxRow[]): Promise<Buffer> {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const column = (index: number) => String.fromCharCode(65 + index);
  const serial = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const cell = (ref: string, value: string | { date: string }) =>
    typeof value === 'string'
      ? `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`
      : `<c r="${ref}" s="1"><v>${serial(value.date)}</v></c>`;
  const rowXml = (cells: Array<string | { date: string }>, rowNumber: number) =>
    `<row r="${rowNumber}">${cells.map((value, index) => cell(`${column(index)}${rowNumber}`, value)).join('')}</row>`;
  const sheetRows = [rowXml(headers, 1), ...rows.map((row, index) => rowXml(headers.map((h) => row[h] ?? ''), index + 2))];
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const relNs = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook ${ns} ${relNs}><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/styles.xml', `<?xml version="1.0"?><styleSheet ${ns}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet ${ns}><sheetData>${sheetRows.join('')}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

export const REGISTRY_HEADERS = ['ID', 'Atividade', 'Responsáveis', 'Prazo', 'Frente', 'Prioridade', 'Status', 'Próximo passo', 'Origem', 'Notas e bloqueios'];

export function registryRow(id: string, title: string, owners: string, due: string, front: string, status: string, nextStep: string): XlsxRow {
  return { ID: id, Atividade: title, Responsáveis: owners, Prazo: { date: due }, Frente: front, Prioridade: 'Média', Status: status, 'Próximo passo': nextStep, Origem: 'Ata_2026-10-01.md', 'Notas e bloqueios': '' };
}
