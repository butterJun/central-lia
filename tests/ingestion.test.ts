import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalFolderGateway } from '../src/server/drive/local-drive.ts';
import {
  classifyTextDocument,
  findRegistryPointer,
  namesListedInIndex,
  sameFileName,
} from '../src/server/ingestion/authority.ts';
import { extractContent } from '../src/server/ingestion/extract.ts';
import { isDeprecated, parseDocumentMeta, splitSections, stripMetaBlock } from '../src/server/ingestion/frontmatter.ts';
import { looksLikeActivityRegistry, readWorkbook } from '../src/server/ingestion/spreadsheet.ts';
import {
  CONFLICT_DIR,
  INITIAL_LOAD_DIR,
  LATER_DIR,
  copyFixture,
  makePdf,
  makeTempDir,
  readFixture,
} from './helpers.ts';

describe('document metadata', () => {
  it('reads status and meeting date from a minutes header', () => {
    const meta = parseDocumentMeta(readFixture(LATER_DIR, 'Ata_2026-10-03.md'));
    expect(meta.title).toBe('Ata de reunião de 3 de outubro de 2026');
    expect(meta.status).toBe('ativo');
    expect(meta.date).toBe('2026-10-03');
  });

  it('accepts the escaped and bold form produced by Google Docs Markdown export', () => {
    const exported = '# Ata nova\n\n**status:** ativo\n\ndata\\_da\\_reuniao: 2026-10-05\n\nTexto.';
    const meta = parseDocumentMeta(exported);
    expect(meta.status).toBe('ativo');
    expect(meta.date).toBe('2026-10-05');
  });

  it('falls back to the date in the file name and flags deprecated documents', () => {
    expect(parseDocumentMeta('Texto sem cabeçalho', 'Ata_2026-11-02.md').date).toBe('2026-11-02');
    expect(isDeprecated(parseDocumentMeta(readFixture(INITIAL_LOAD_DIR, 'PLANO_EDITORIAL_ANTIGO.md')))).toBe(true);
    expect(isDeprecated(parseDocumentMeta(readFixture(INITIAL_LOAD_DIR, 'GUIA_INICIAL.md')))).toBe(false);
  });

  it('splits sections and strips the metadata block', () => {
    const guide = readFixture(INITIAL_LOAD_DIR, 'GUIA_INICIAL.md');
    expect(splitSections(guide).map((s) => s.heading)).toEqual(['Comece aqui', 'Para um membro novo', 'Frentes e pessoas']);
    expect(stripMetaBlock(readFixture(INITIAL_LOAD_DIR, 'ESTADO-ATUAL.md'))).toMatch(/^Esta organização fictícia/);
  });
});

describe('authority rules', () => {
  const index = readFixture(INITIAL_LOAD_DIR, 'INDEX.md');

  it('finds the registry declared by INDEX.md, including the sheet name', () => {
    const pointer = findRegistryPointer([
      { name: 'GUIA_INICIAL.md', text: readFixture(INITIAL_LOAD_DIR, 'GUIA_INICIAL.md') },
      { name: 'INDEX.md', text: index },
    ]);
    expect(pointer).toEqual({ fileName: 'Ata_registro.xlsx', sheet: 'Atividades', declaredIn: 'INDEX.md' });
  });

  it('returns null when no document declares a registry', () => {
    expect(findRegistryPointer([{ name: 'nota.md', text: 'Nada sobre planilhas.' }])).toBeNull();
  });

  it('classifies documents by role', () => {
    const listed = namesListedInIndex(index);
    const role = (name: string, dir = INITIAL_LOAD_DIR) =>
      classifyTextDocument(name, parseDocumentMeta(readFixture(dir, name), name), listed);
    expect(role('INDEX.md')).toBe('direction');
    expect(role('ESTADO-ATUAL.md')).toBe('direction');
    expect(role('GUIA_INICIAL.md')).toBe('direction');
    expect(role('PLANO_EDITORIAL_ANTIGO.md')).toBe('historical');
    expect(role('Ata_2026-10-01.md')).toBe('minutes');
    expect(role('Ata_2026-10-04.md', LATER_DIR)).toBe('minutes');
  });

  it('compares spreadsheet names ignoring case, accents and extension', () => {
    expect(sameFileName('Ata_registro.xlsx', 'ata_registro')).toBe(true);
    expect(sameFileName('Ata_registro.xlsx', 'Ata - copia vazia.xlsx')).toBe(false);
  });
});

describe('spreadsheets', () => {
  it('reads the initial registry preserving two owners, the blocked task and ISO dates', async () => {
    const [sheet] = await readWorkbook(fs.readFileSync(path.join(INITIAL_LOAD_DIR, 'Ata_registro.xlsx')));
    expect(sheet?.name).toBe('Atividades');
    expect(sheet && looksLikeActivityRegistry(sheet)).toBe(true);
    expect(sheet?.rows).toHaveLength(4);
    const act104 = sheet?.rows.find((row) => row.cells.ID === 'ACT-104');
    expect(act104?.cells['Responsáveis']).toBe('Ana; Davi');
    expect(act104?.rowNumber).toBe(5);
    const act103 = sheet?.rows.find((row) => row.cells.ID === 'ACT-103');
    expect(act103?.cells.Status).toBe('Bloqueada');
    expect(sheet?.rows[0]?.cells.Prazo).toBe('2026-10-05');
  });

  it('recognizes the empty look-alike spreadsheet as registry-shaped but without rows', async () => {
    const [sheet] = await readWorkbook(fs.readFileSync(path.join(CONFLICT_DIR, 'Ata - copia vazia.xlsx')));
    expect(sheet && looksLikeActivityRegistry(sheet)).toBe(true);
    expect(sheet?.rows).toHaveLength(0);
  });
});

describe('content extraction by format', () => {
  async function extract(name: string, content?: string | Buffer) {
    const dir = makeTempDir();
    if (content === undefined) copyFixture(LATER_DIR, name, dir);
    else fs.writeFileSync(path.join(dir, name), content);
    const gateway = new LocalFolderGateway(dir);
    const [file] = await gateway.listTree();
    if (!file) throw new Error('fixture not listed');
    return extractContent(gateway, file);
  }

  it('reads Markdown as text', async () => {
    const result = await extract('Ata_2026-10-04.md');
    expect(result.kind).toBe('text');
    if (result.kind === 'text') expect(result.text).toContain('Carla revisará a pauta');
  });

  it('reads native Google Docs (simulated by .gdoc locally) as text', async () => {
    const result = await extract('Ata nova.gdoc', '# Ata\nstatus: ativo\n');
    expect(result).toEqual({ kind: 'text', text: '# Ata\nstatus: ativo\n' });
  });

  it('reads PDFs with selectable text', async () => {
    const result = await extract('decisao.pdf', makePdf('ACT-102: Davi entregara o checklist ate 2026-10-08.'));
    expect(result.kind).toBe('text');
    if (result.kind === 'text') expect(result.text).toContain('ACT-102');
  });

  it('reports unsupported formats with a reason instead of inventing content', async () => {
    const docx = await extract('Ata_2026-10-03.docx');
    expect(docx.kind).toBe('unsupported');
    if (docx.kind === 'unsupported') expect(docx.reason).toMatch(/Google Docs/);
    const image = await extract('foto.png', Buffer.from([0x89, 0x50]));
    expect(image).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/OCR/) });
  });

  it('treats a PDF without text as not processed (would need OCR)', async () => {
    const result = await extract('scan.pdf', makePdf(''));
    expect(result).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/OCR/) });
  });
});
