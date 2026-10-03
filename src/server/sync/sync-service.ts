import type { SyncRun, SyncRunStats, SyncTrigger } from '../../shared/domain.ts';
import type { RegistryImporter } from '../activities/registry-importer.ts';
import { DriveAuthError, type DriveFile, type DriveFolderInfo, type DriveGateway } from '../drive/types.ts';
import {
  classifyTextDocument,
  findRegistryPointer,
  isIndexDocument,
  namesListedInIndex,
  sameFileName,
  type RegistryPointer,
} from '../ingestion/authority.ts';
import { extractContent } from '../ingestion/extract.ts';
import { parseDocumentMeta } from '../ingestion/frontmatter.ts';
import { looksLikeActivityRegistry, type SheetTable } from '../ingestion/spreadsheet.ts';
import { errorMessage } from '../lib/errors.ts';
import { sha256 } from '../lib/text.ts';
import type { ConflictsRepo } from '../repositories/conflicts-repo.ts';
import type { KvRepo } from '../repositories/kv-repo.ts';
import type { SourceRecord, SourcesRepo } from '../repositories/sources-repo.ts';
import type { SyncRunsRepo } from '../repositories/sync-runs-repo.ts';
import type { SuggestionService } from '../suggestions/suggestion-service.ts';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SyncDependencies {
  gateway: DriveGateway;
  sources: SourcesRepo;
  kv: KvRepo;
  syncRuns: SyncRunsRepo;
  conflicts: ConflictsRepo;
  suggestionService: SuggestionService;
  registryImporter: RegistryImporter;
  registryFileNameFallback: string | null;
  onAuthError?: () => void;
  logger: Logger;
}

const FOLDER_KEY = 'drive.folder';
const SETTLED_STATUSES = new Set(['processed', 'ignored', 'unsupported']);

function emptyStats(): SyncRunStats {
  return { listed: 0, processed: 0, unchanged: 0, failed: 0, ignored: 0, unsupported: 0, unavailable: 0, suggestionsCreated: 0 };
}

/**
 * One synchronization pass over the configured folder:
 *  1. list the tree and (re)read only files whose Drive version changed;
 *  2. mark files that vanished (deleted, moved out, access revoked) as unavailable;
 *  3. apply authority rules (registry vs. look-alike spreadsheets, document roles);
 *  4. analyze minutes whose text changed and store suggestions for human review.
 * A failure on one file never aborts the others; an authorization failure aborts
 * the run and keeps the last confirmed state, flagged as stale.
 */
export class SyncService {
  private current: Promise<SyncRun> | null = null;

  constructor(private readonly deps: SyncDependencies) {}

  isRunning(): boolean {
    return this.current !== null;
  }

  folder(): DriveFolderInfo | null {
    return this.deps.kv.get<DriveFolderInfo>(FOLDER_KEY);
  }

  /** Concurrent calls share the same run (the manual button cannot start a parallel sync). */
  run(trigger: SyncTrigger): Promise<SyncRun> {
    if (!this.current) {
      this.current = this.execute(trigger).finally(() => {
        this.current = null;
      });
    }
    return this.current;
  }

  private async execute(trigger: SyncTrigger): Promise<SyncRun> {
    const { syncRuns, logger } = this.deps;
    const runId = syncRuns.start(trigger);
    const stats = emptyStats();
    try {
      this.deps.kv.set(FOLDER_KEY, await this.deps.gateway.describeRoot());
      const files = await this.deps.gateway.listTree();
      stats.listed = files.length;
      for (const file of files) await this.ingestFile(file, stats);
      this.markMissing(new Set(files.map((file) => file.id)), stats);
      this.applyAuthority(stats);
      await this.analyzeChangedDocuments(stats);
      const status = stats.failed > 0 ? 'partial' : 'success';
      syncRuns.finish(runId, status, stats, null);
      logger.info(`Sincronização ${trigger}: ${JSON.stringify(stats)}`);
    } catch (error) {
      if (error instanceof DriveAuthError) this.deps.onAuthError?.();
      syncRuns.finish(runId, 'failed', stats, errorMessage(error));
      logger.error(`Sincronização falhou: ${errorMessage(error)}`);
    }
    return syncRuns.latest() as SyncRun;
  }

  private async ingestFile(file: DriveFile, stats: SyncRunStats): Promise<void> {
    const { sources } = this.deps;
    const previous = sources.get(file.id);
    sources.upsertObserved({
      fileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webUrl: file.webViewLink,
      modifiedAt: file.modifiedTime,
      versionOrHash: file.version,
      path: file.path,
    });
    const unchanged = previous && previous.versionOrHash === file.version && SETTLED_STATUSES.has(previous.syncStatus);
    if (unchanged) {
      stats.unchanged += 1;
      return;
    }
    try {
      await this.extractInto(file, stats);
    } catch (error) {
      if (error instanceof DriveAuthError) throw error;
      stats.failed += 1;
      const hasOldCopy = Boolean(sources.getContent(file.id));
      const detail = `${errorMessage(error)}${hasOldCopy ? ' — mantida a versão lida anteriormente, possivelmente desatualizada.' : ''}`;
      sources.patch(file.id, { syncStatus: 'failed', statusDetail: detail });
      this.deps.logger.warn(`Falha ao ler ${file.name}: ${errorMessage(error)}`);
    }
  }

  private async extractInto(file: DriveFile, stats: SyncRunStats): Promise<void> {
    const { sources } = this.deps;
    const now = new Date().toISOString();
    const result = await extractContent(this.deps.gateway, file);
    if (result.kind === 'unsupported') {
      sources.deleteContent(file.id);
      sources.patch(file.id, { syncStatus: 'unsupported', statusDetail: result.reason, role: 'other', lastProcessedAt: now });
      stats.unsupported += 1;
      return;
    }
    const meta = result.kind === 'text' ? parseDocumentMeta(result.text, file.name) : null;
    sources.saveContent(file.id, file.version, result.text, result.kind === 'spreadsheet' ? result.tables : null);
    sources.patch(file.id, {
      syncStatus: 'processed',
      statusDetail: null,
      docStatus: meta?.status ?? null,
      docDate: meta?.date ?? null,
      contentHash: sha256(result.text),
      lastProcessedAt: now,
    });
    stats.processed += 1;
  }

  private markMissing(seen: Set<string>, stats: SyncRunStats): void {
    const { sources, suggestionService } = this.deps;
    for (const source of sources.list()) {
      if (seen.has(source.fileId) || source.syncStatus === 'unavailable') continue;
      sources.deleteContent(source.fileId);
      sources.patch(source.fileId, {
        syncStatus: 'unavailable',
        statusDetail: 'Não encontrado na pasta: removido, movido para fora do escopo ou acesso revogado. Dados derivados dele aparecem como fonte indisponível.',
        analysis: null,
      });
      suggestionService.supersedeAllFrom(source.fileId, 'O documento de origem ficou indisponível.');
      stats.unavailable += 1;
    }
  }

  private applyAuthority(stats: SyncRunStats): void {
    const { sources } = this.deps;
    const processed = sources.list().filter((source) => source.syncStatus === 'processed' || source.syncStatus === 'failed');
    const withContent = processed.flatMap((source) => {
      const content = sources.getContent(source.fileId);
      return content ? [{ source, content }] : [];
    });
    const textDocs = withContent.filter((item) => !Array.isArray(item.content.tables));
    const sheets = withContent.filter((item) => Array.isArray(item.content.tables));

    const pointer = findRegistryPointer(textDocs.map((item) => ({ name: item.source.name, text: item.content.text }))) ?? this.fallbackPointer();
    const index = textDocs.find((item) => isIndexDocument(item.source.name));
    const listed = namesListedInIndex(index?.content.text ?? '');
    for (const { source, content } of textDocs) {
      sources.patch(source.fileId, { role: classifyTextDocument(source.name, parseDocumentMeta(content.text, source.name), listed) });
    }
    const registry = this.chooseRegistry(sheets.map((item) => item.source), pointer);
    for (const { source, content } of sheets) {
      const tables = content.tables as SheetTable[];
      if (registry && source.fileId === registry.fileId && pointer) {
        sources.patch(source.fileId, { role: 'registry' });
        const isCurrent = source.syncStatus === 'processed' && content.versionOrHash === source.versionOrHash;
        if (isCurrent) this.applyRegistry(source, tables, pointer, stats);
      } else if (tables.some(looksLikeActivityRegistry)) {
        this.markShadowRegistry(source, tables, pointer);
      } else {
        sources.patch(source.fileId, { role: 'other' });
      }
    }
  }

  /** Only the version actually read is compared; a failure leaves the version pending for the next run. */
  private applyRegistry(source: SourceRecord, tables: SheetTable[], pointer: RegistryPointer, stats: SyncRunStats): void {
    try {
      stats.suggestionsCreated += this.deps.registryImporter.apply(source, tables, pointer);
    } catch (error) {
      stats.failed += 1;
      this.deps.sources.patch(source.fileId, { statusDetail: `Lido, mas a comparação com o registro falhou: ${errorMessage(error)}. Será tentada de novo.` });
      this.deps.logger.warn(`Registro ${source.name}: ${errorMessage(error)}`);
    }
  }

  private fallbackPointer(): RegistryPointer | null {
    const name = this.deps.registryFileNameFallback;
    return name ? { fileName: name, sheet: null, declaredIn: 'configuração REGISTRY_FILE_NAME' } : null;
  }

  /** Same-name candidates: keep the one already imported, else the first seen; never pick by recency. */
  private chooseRegistry(candidates: SourceRecord[], pointer: RegistryPointer | null): SourceRecord | undefined {
    if (!pointer) return undefined;
    const matching = candidates.filter((source) => sameFileName(source.name, pointer.fileName));
    if (matching.length <= 1) return matching[0];
    const importedId = this.deps.registryImporter.importedFileId();
    const chosen = matching.find((source) => source.fileId === importedId) ?? [...matching].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))[0];
    for (const other of matching.filter((source) => source !== chosen)) {
      this.deps.conflicts.open(
        'registry_ambiguous',
        other.fileId,
        `registry-ambiguous:${other.fileId}`,
        `Há mais de um arquivo chamado "${pointer.fileName}" (${other.path}). Mantida como fonte a cópia já importada (${chosen?.path}); a outra não altera atividades.`,
      );
    }
    return chosen;
  }

  private markShadowRegistry(source: SourceRecord, tables: SheetTable[], pointer: RegistryPointer | null): void {
    const rowCount = tables.filter(looksLikeActivityRegistry).reduce((total, table) => total + table.rows.length, 0);
    const official = pointer ? `"${pointer.fileName}" (indicada em ${pointer.declaredIn})` : 'nenhuma planilha indicada pelo índice';
    const detail = `Planilha com formato de registro, mas a fonte vigente é ${official}. ${
      rowCount === 0 ? 'Está vazia.' : `Tem ${rowCount} linha(s).`
    } Não altera nem apaga atividades.`;
    this.deps.sources.patch(source.fileId, { role: 'shadow_registry', statusDetail: detail });
    this.deps.conflicts.open('shadow_registry', source.fileId, `shadow:${source.fileId}:${source.versionOrHash}`, `${source.name}: ${detail}`);
  }

  private async analyzeChangedDocuments(stats: SyncRunStats): Promise<void> {
    const { sources, suggestionService, logger } = this.deps;
    for (const source of sources.list()) {
      if (source.role !== 'minutes' || source.syncStatus !== 'processed') continue;
      const content = sources.getContent(source.fileId);
      const upToDate = source.analysis && !source.analysis.degraded && source.analysis.contentHash === sha256(content?.text ?? '');
      if (!content || upToDate) continue;
      try {
        const analysis = await suggestionService.analyzeDocument(source, content.text);
        sources.patch(source.fileId, { analysis, statusDetail: null });
        stats.suggestionsCreated += analysis.suggestionsCreated;
      } catch (error) {
        stats.failed += 1;
        logger.warn(`Análise de ${source.name} falhou: ${errorMessage(error)}`);
        sources.patch(source.fileId, { statusDetail: `Lido, mas a análise falhou: ${errorMessage(error)}. Será tentada de novo.` });
      }
    }
  }
}

