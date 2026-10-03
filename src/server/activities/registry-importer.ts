import {
  ACTIVITY_FIELDS,
  ACTIVITY_STATUS_LABELS,
  type ActivityFields,
  type ActivityStatus,
  type FieldValue,
  type ProposedFields,
  type RegistryInfo,
} from '../../shared/domain.ts';
import { isIsoDate } from '../../shared/dates.ts';
import { nowIso, transaction, type Db } from '../db/database.ts';
import type { RegistryPointer } from '../ingestion/authority.ts';
import { findHeader, REGISTRY_COLUMNS, type SheetRow, type SheetTable } from '../ingestion/spreadsheet.ts';
import { normalizeForMatch } from '../lib/text.ts';
import type { ActivitiesRepo } from '../repositories/activities-repo.ts';
import type { ConflictsRepo } from '../repositories/conflicts-repo.ts';
import type { KvRepo } from '../repositories/kv-repo.ts';
import type { MembersRepo } from '../repositories/members-repo.ts';
import type { SourceRecord, SourcesRepo } from '../repositories/sources-repo.ts';
import type { SuggestionDraft } from '../suggestions/contract.ts';
import type { SuggestionService } from '../suggestions/suggestion-service.ts';
import { diffFields, pickFields, sameFieldValue } from './activity-service.ts';

/**
 * Official-source rule (see docs/adr/0001-fonte-oficial.md):
 *  1. The spreadsheet named by the index document is imported ONCE into the
 *     app database, which becomes the operational source of truth.
 *  2. Later edits of that spreadsheet are compared with the import snapshot and
 *     become pending suggestions — never silent overwrites.
 *  3. Rows that disappear, or an emptied spreadsheet, open a conflict; nothing
 *     is deleted.
 */

export interface RegistryRow {
  id: string;
  rowNumber: number;
  fields: ActivityFields;
  unresolvedOwners: string[];
  ownersText: string;
  priority: string | null;
  notes: string | null;
  origin: string | null;
}

interface RegistryBaseline {
  fileId: string;
  sheet: string;
  importedAt: string;
  importedVersion: string;
  comparedVersion: string;
  pointerFrom: string;
  rows: Record<string, RegistryRow>;
}

const BASELINE_KEY = 'registry.baseline';
/** The registry spreadsheet has no description column; never propose to clear one. */
const SHEET_FIELDS = ACTIVITY_FIELDS.filter((field) => field !== 'description');
const GENERATOR = 'registro de atividades (planilha indicada pelo índice)';

const STATUS_BY_LABEL: Record<string, ActivityStatus> = {
  'a fazer': 'todo',
  pendente: 'todo',
  'nao iniciada': 'todo',
  'em andamento': 'in_progress',
  andamento: 'in_progress',
  'em progresso': 'in_progress',
  bloqueada: 'blocked',
  bloqueado: 'blocked',
  concluida: 'done',
  concluido: 'done',
  feito: 'done',
  feita: 'done',
};

export class RegistryImporter {
  constructor(
    private readonly db: Db,
    private readonly activities: ActivitiesRepo,
    private readonly members: MembersRepo,
    private readonly sources: SourcesRepo,
    private readonly conflicts: ConflictsRepo,
    private readonly kv: KvRepo,
    private readonly suggestionService: SuggestionService,
  ) {}

  info(): RegistryInfo | null {
    const baseline = this.kv.get<RegistryBaseline>(BASELINE_KEY);
    if (!baseline) return null;
    return {
      source: this.sources.link(baseline.fileId),
      sheet: baseline.sheet,
      importedAt: baseline.importedAt,
      importedVersion: baseline.importedVersion,
      lastComparedVersion: baseline.comparedVersion,
      pointerFrom: baseline.pointerFrom,
    };
  }

  importedFileId(): string | null {
    return this.kv.get<RegistryBaseline>(BASELINE_KEY)?.fileId ?? null;
  }

  /** Applies the registry rule to the current content of the authoritative spreadsheet. Returns suggestions created. */
  apply(source: SourceRecord, tables: SheetTable[], pointer: RegistryPointer): number {
    const table = pickTable(tables, pointer.sheet);
    if (!table) {
      this.conflicts.open(
        'registry_empty',
        source.fileId,
        `registry-sheet-missing:${source.fileId}:${source.versionOrHash}`,
        `${source.name} foi indicada como fonte das atividades, mas não tem a aba "${pointer.sheet ?? 'Atividades'}" com colunas ID e Atividade. Nenhuma atividade foi alterada.`,
      );
      return 0;
    }
    const rows = this.withoutDuplicates(source, table, parseRegistryTable(table, (name) => this.members.findByName(name)?.id));
    const baseline = this.kv.get<RegistryBaseline>(BASELINE_KEY);
    if (!baseline) return this.firstImport(source, table.name, rows, pointer);
    if (baseline.fileId === source.fileId && baseline.comparedVersion === source.versionOrHash) return 0;
    return this.compareWithOfficial(source, rows, baseline);
  }

  /** Repeated ids keep the first row; repeated or incomplete rows are reported, never silently dropped. */
  private withoutDuplicates(source: SourceRecord, table: SheetTable, rows: RegistryRow[]): RegistryRow[] {
    const seen = new Set<string>();
    const unique = rows.filter((row) => {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        return true;
      }
      this.conflicts.open(
        'registry_ambiguous',
        source.fileId,
        `registry-duplicate:${source.fileId}:${source.versionOrHash}:${row.rowNumber}`,
        `${source.name}, linha ${row.rowNumber}: o ID ${row.id} se repete. Foi considerada apenas a primeira ocorrência.`,
      );
      return false;
    });
    const parsedRows = new Set(rows.map((row) => row.rowNumber));
    for (const incomplete of table.rows.filter((row) => !parsedRows.has(row.rowNumber))) {
      this.conflicts.open(
        'registry_ambiguous',
        source.fileId,
        `registry-incomplete:${source.fileId}:${source.versionOrHash}:${incomplete.rowNumber}`,
        `${source.name}, linha ${incomplete.rowNumber}: sem ID ou sem título; a linha foi ignorada.`,
      );
    }
    return unique;
  }

  private firstImport(source: SourceRecord, sheet: string, rows: RegistryRow[], pointer: RegistryPointer): number {
    if (rows.length === 0) {
      this.openEmptyConflict(source);
      return 0;
    }
    transaction(this.db, () => {
      const now = nowIso();
      for (const row of rows) this.importRow(source, sheet, row, now);
      this.kv.set(BASELINE_KEY, {
        fileId: source.fileId,
        sheet,
        importedAt: now,
        importedVersion: source.versionOrHash,
        comparedVersion: source.versionOrHash,
        pointerFrom: pointer.declaredIn,
        rows: Object.fromEntries(rows.map((row) => [row.id, row])),
      } satisfies RegistryBaseline);
    });
    return 0;
  }

  private importRow(source: SourceRecord, sheet: string, row: RegistryRow, now: string): void {
    if (this.activities.exists(row.id)) return;
    this.activities.insert({
      ...row.fields,
      id: row.id,
      priority: row.priority,
      notes: row.notes,
      unresolvedOwners: row.unresolvedOwners,
      origin: 'import',
      createdBy: 'system',
      createdAt: now,
    });
    this.activities.addEvent({
      activityId: row.id,
      actorId: 'system',
      timestamp: now,
      kind: 'imported',
      changes: ACTIVITY_FIELDS.map((field) => ({ field, before: null, after: row.fields[field] as FieldValue })),
      reason: `Importada de ${source.name} (aba ${sheet}, linha ${row.rowNumber})`,
      sourceFileId: source.fileId,
      sourceVersion: source.versionOrHash,
      suggestionId: null,
    });
    this.activities.addRef({
      activityId: row.id,
      fileId: source.fileId,
      versionOrHash: source.versionOrHash,
      location: `Aba ${sheet}, linha ${row.rowNumber}`,
      quote: describeRow(row),
      relationType: 'imported_from',
      createdAt: now,
    });
    const origin = row.origin ? this.sources.list().find((s) => normalizeForMatch(s.name) === normalizeForMatch(row.origin ?? '')) : undefined;
    if (origin) {
      this.activities.addRef({
        activityId: row.id,
        fileId: origin.fileId,
        versionOrHash: origin.versionOrHash,
        location: 'Origem declarada na planilha',
        quote: `Coluna Origem: ${row.origin}`,
        relationType: 'created_by',
        createdAt: now,
      });
    }
  }

  /** Atomic: the version is marked as compared only together with the suggestions it produced. */
  private compareWithOfficial(source: SourceRecord, rows: RegistryRow[], baseline: RegistryBaseline): number {
    const sameFile = baseline.fileId === source.fileId;
    return transaction(this.db, () => {
      if (rows.length === 0) {
        this.openEmptyConflict(source);
        this.recordCompared(baseline, source, sameFile, []);
        return 0;
      }
      const snapshots = sameFile ? baseline.rows : {};
      const drafts = rows.flatMap((row) => this.draftForRow(row, snapshots[row.id], sameFile, baseline.sheet));
      this.openRemovedRowConflicts(source, rows, Object.keys(snapshots));
      const created = this.suggestionService.saveDrafts(source, drafts, GENERATOR).created;
      this.recordCompared(baseline, source, sameFile, rows);
      return created;
    });
  }

  /** Rows that first appear after the import get their own snapshot, so later edits are compared with it. */
  private recordCompared(baseline: RegistryBaseline, source: SourceRecord, sameFile: boolean, rows: RegistryRow[]): void {
    if (!sameFile) return;
    const newRows = rows.filter((row) => !baseline.rows[row.id]);
    this.kv.set(BASELINE_KEY, {
      ...baseline,
      comparedVersion: source.versionOrHash,
      rows: { ...baseline.rows, ...Object.fromEntries(newRows.map((row) => [row.id, row])) },
    } satisfies RegistryBaseline);
  }

  private openRemovedRowConflicts(source: SourceRecord, rows: RegistryRow[], expectedIds: string[]): void {
    const present = new Set(rows.map((row) => row.id));
    for (const missingId of expectedIds.filter((id) => !present.has(id) && this.activities.exists(id))) {
      this.conflicts.open(
        'registry_row_removed',
        source.fileId,
        `row-removed:${source.fileId}:${missingId}:${source.versionOrHash}`,
        `${missingId} não aparece mais em ${source.name}. A atividade foi mantida no painel; decida se deve ser concluída ou mantida.`,
      );
    }
  }

  /** Spreadsheet value differs from its snapshot AND from the official value → proposal. */
  private draftForRow(row: RegistryRow, snapshot: RegistryRow | undefined, sameFile: boolean, sheet: string): SuggestionDraft[] {
    const location = `Aba ${sheet}, linha ${row.rowNumber}`;
    const current = this.activities.get(row.id);
    if (!current) {
      return [
        {
          kind: 'create',
          targetActivityId: row.id,
          proposed: row.fields,
          baseline: {},
          evidence: describeRow(row),
          location,
          reason: `Nova linha ${row.id} adicionada à planilha de registro depois da importação.`,
          uncertainties: row.unresolvedOwners.map((name) => `Responsável "${name}" não é um membro cadastrado: a confirmar.`),
          possibleDuplicateOf: null,
        },
      ];
    }
    if (sameFile && !snapshot) return [];
    const edited = SHEET_FIELDS.filter(
      (field) => !snapshot || !sameFieldValue(row.fields[field] as FieldValue, snapshot.fields[field] as FieldValue),
    );
    const editedInSheet = Object.fromEntries(edited.map((field) => [field, row.fields[field]])) as ProposedFields;
    const changes = diffFields(pickFields(current), editedInSheet);
    if (changes.length === 0) return [];
    return [
      {
        kind: 'update',
        targetActivityId: row.id,
        proposed: Object.fromEntries(changes.map((change) => [change.field, change.after])) as ProposedFields,
        baseline: Object.fromEntries(changes.map((change) => [change.field, change.before])) as ProposedFields,
        evidence: describeRow(row),
        location,
        reason: 'A planilha de registro foi editada depois da importação; pela regra de precedência, a edição vira proposta.',
        uncertainties: [],
        possibleDuplicateOf: null,
      },
    ];
  }

  private openEmptyConflict(source: SourceRecord): void {
    this.conflicts.open(
      'registry_empty',
      source.fileId,
      `registry-empty:${source.fileId}:${source.versionOrHash}`,
      `${source.name} (fonte indicada pelo índice) está sem atividades nesta versão. Nenhuma atividade foi apagada; confirme se a planilha foi esvaziada por engano.`,
    );
  }
}

function pickTable(tables: SheetTable[], sheet: string | null): SheetTable | undefined {
  const registryShaped = tables.filter((table) => findHeader(table.headers, REGISTRY_COLUMNS.id) && findHeader(table.headers, REGISTRY_COLUMNS.title));
  if (sheet) {
    const named = registryShaped.find((table) => normalizeForMatch(table.name) === normalizeForMatch(sheet));
    if (named) return named;
  }
  return registryShaped[0];
}

export function parseRegistryTable(table: SheetTable, resolveMember: (name: string) => string | undefined): RegistryRow[] {
  const column = (candidates: readonly string[]) => findHeader(table.headers, candidates);
  const columns = Object.fromEntries(
    Object.entries(REGISTRY_COLUMNS).map(([key, candidates]) => [key, column(candidates)]),
  ) as Record<keyof typeof REGISTRY_COLUMNS, string | undefined>;
  const cell = (row: SheetRow, key: keyof typeof REGISTRY_COLUMNS) => (columns[key] ? (row.cells[columns[key]] ?? '').trim() : '');

  return table.rows
    .map((row) => {
      const ownerNames = splitOwners(cell(row, 'owners'));
      const resolved = ownerNames.map((name) => ({ name, id: resolveMember(name) }));
      return {
        id: cell(row, 'id').toUpperCase(),
        rowNumber: row.rowNumber,
        fields: {
          title: cell(row, 'title'),
          description: '',
          nextStep: cell(row, 'nextStep'),
          ownerIds: resolved.flatMap((owner) => (owner.id ? [owner.id] : [])),
          front: cell(row, 'front') || 'A definir',
          status: parseStatus(cell(row, 'status')),
          dueDate: parseDate(cell(row, 'dueDate')),
        },
        unresolvedOwners: resolved.filter((owner) => !owner.id).map((owner) => owner.name),
        ownersText: ownerNames.join('; '),
        priority: cell(row, 'priority') || null,
        notes: cell(row, 'notes') || null,
        origin: cell(row, 'origin') || null,
      };
    })
    .filter((row) => row.id !== '' && row.fields.title !== '');
}

function splitOwners(value: string): string[] {
  return value
    .split(/\s*(?:;|,|\/|\s+e\s+)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
}

function parseStatus(value: string): ActivityStatus {
  return STATUS_BY_LABEL[normalizeForMatch(value)] ?? 'todo';
}

function parseDate(value: string): string | null {
  const iso = value.slice(0, 10);
  if (isIsoDate(iso)) return iso;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const candidate = `${match[3]}-${match[2]?.padStart(2, '0')}-${match[1]?.padStart(2, '0')}`;
  return isIsoDate(candidate) ? candidate : null;
}

function describeRow(row: RegistryRow): string {
  const owners = row.ownersText || 'sem responsável';
  return `${row.id} | ${row.fields.title} | ${owners} | prazo ${row.fields.dueDate ?? 'a definir'} | ${row.fields.front} | ${ACTIVITY_STATUS_LABELS[row.fields.status]}`;
}
