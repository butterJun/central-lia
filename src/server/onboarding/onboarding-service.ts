import type { Onboarding, OnboardingDocument } from '../../shared/domain.ts';
import type { RegistryImporter } from '../activities/registry-importer.ts';
import { toSummary } from '../digest/digest-service.ts';
import { isIndexDocument } from '../ingestion/authority.ts';
import { parseDocumentMeta, splitSections, stripMetaBlock } from '../ingestion/frontmatter.ts';
import { normalizeForMatch } from '../lib/text.ts';
import type { ActivitiesRepo } from '../repositories/activities-repo.ts';
import type { SourceRecord, SourcesRepo } from '../repositories/sources-repo.ts';

/**
 * "Comece aqui": built from the direction documents in the Drive folder, never
 * from text written by this app. Partial or "to be confirmed" facts are flagged
 * as such instead of being presented as official.
 */

const PARTIAL_STATUSES = new Set(['parcial', 'rascunho', 'provisorio', 'provisório', 'em revisao', 'em revisão']);
const UNCERTAIN_PHRASE = /(a confirmar|provis[oó]ri|ainda ser[aá]|n[aã]o (é|e) (um )?texto oficial|por confirmar|pendente de aprova)/i;
const DEFAULT_PRECEDENCE =
  'Decisão humana aprovada na aplicação > proposta de ata pendente de aprovação > estado atual documentado > fonte ativa indicada no índice > arquivo antigo ou sem autoridade.';
const MAX_GAPS = 8;

interface DirectionDoc {
  source: SourceRecord;
  text: string;
}

export class OnboardingService {
  constructor(
    private readonly sources: SourcesRepo,
    private readonly activities: ActivitiesRepo,
    private readonly registry: RegistryImporter,
  ) {}

  build(memberId: string): Onboarding {
    const docs = this.readableDocs();
    const index = docs.find((doc) => isIndexDocument(doc.source.name));
    const state = docs.find((doc) => /estado|sobre|proposito|missao/i.test(normalizeForMatch(doc.source.name)));
    const guide = docs.find((doc) => /guia|comece|onboarding|boas.vindas/i.test(normalizeForMatch(doc.source.name)));
    const firstAction = this.activities
      .list()
      .filter((activity) => activity.ownerIds.includes(memberId) && activity.status !== 'done')
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))[0];

    return {
      purpose: state
        ? { markdown: firstParagraphs(stripMetaBlock(state.text), 1), partial: isPartial(state), source: this.sources.link(state.source.fileId) }
        : null,
      fronts: this.section(guide ?? state, /frentes/i),
      steps: this.section(guide, /membro novo|primeiros passos|como come[cç]ar/i),
      documents: this.listedDocuments(index, docs),
      historical: this.sources
        .list()
        .filter((source) => source.role === 'historical')
        .map((source) => ({ source: this.sources.link(source.fileId), supersededBy: this.supersededBy(source) })),
      registry: this.registry.info(),
      precedenceRule: precedenceFrom(index?.text) ?? DEFAULT_PRECEDENCE,
      firstAction: firstAction ? toSummary(firstAction) : null,
      gaps: this.gaps(docs, Boolean(firstAction)),
    };
  }

  private readableDocs(): DirectionDoc[] {
    return this.sources
      .list()
      .filter((source) => source.role === 'direction' && source.syncStatus !== 'unavailable')
      .flatMap((source) => {
        const content = this.sources.getContent(source.fileId);
        return content ? [{ source, text: content.text }] : [];
      });
  }

  private section(doc: DirectionDoc | undefined, heading: RegExp): Onboarding['fronts'] {
    if (!doc) return null;
    const section = splitSections(doc.text).find((s) => heading.test(s.heading) && stripMetaBlock(s.body) !== '');
    return section ? { markdown: stripMetaBlock(section.body), source: this.sources.link(doc.source.fileId) } : null;
  }

  /** Documents the index vouches for, with the description written next to each one. */
  private listedDocuments(index: DirectionDoc | undefined, docs: DirectionDoc[]): OnboardingDocument[] {
    const all = this.sources.list();
    const described = new Map<string, string>();
    for (const line of (index?.text ?? '').split(/\r?\n/)) {
      const match = /^\s*[-*]\s*`([^`]+)`[^:]*:\s*(.+)$/.exec(line);
      if (match) described.set(normalizeForMatch(match[1] ?? ''), (match[2] ?? '').replace(/\*\*/g, '').trim());
    }
    const listed = all.filter((source) => described.has(normalizeForMatch(source.name)));
    const candidates = listed.length > 0 ? listed : docs.map((doc) => doc.source);
    return candidates.map((source) => ({
      source: this.sources.link(source.fileId),
      description: described.get(normalizeForMatch(source.name)) ?? '',
      docStatus: source.docStatus,
      updatedAt: source.docDate,
      partial: PARTIAL_STATUSES.has(source.docStatus ?? ''),
    }));
  }

  private supersededBy(source: SourceRecord): string | null {
    const content = this.sources.getContent(source.fileId);
    return content ? (parseDocumentMeta(content.text, source.name).fields.substituido_por ?? null) : null;
  }

  private gaps(docs: DirectionDoc[], hasFirstAction: boolean): string[] {
    const gaps: string[] = hasFirstAction ? [] : ['Você ainda não tem atividade atribuída. Procure a liderança da sua frente.'];
    for (const doc of docs) {
      const meta = parseDocumentMeta(doc.text, doc.source.name);
      if (PARTIAL_STATUSES.has(meta.status ?? '')) gaps.push(`${doc.source.name} está marcado como "${meta.status}".`);
      if (meta.fields.responsavel_por_confirmar) {
        gaps.push(`${doc.source.name}: confirmação pendente com ${meta.fields.responsavel_por_confirmar}.`);
      }
      if (!isPartial(doc)) continue;
      for (const sentence of stripMetaBlock(doc.text).split(/(?<=[.!?])\s+/)) {
        const withoutQuotes = sentence.replace(/["“'`][^"”'`]*["”'`]/g, '');
        if (UNCERTAIN_PHRASE.test(withoutQuotes)) gaps.push(`${doc.source.name}: ${sentence.replace(/[`*]/g, '').trim()}`);
      }
    }
    const unresolved = this.activities.list().filter((activity) => activity.unresolvedOwners.length > 0);
    for (const activity of unresolved) gaps.push(`${activity.id}: responsável a confirmar.`);
    return [...new Set(gaps)].slice(0, MAX_GAPS);
  }
}

function isPartial(doc: DirectionDoc): boolean {
  return PARTIAL_STATUSES.has(doc.source.docStatus ?? '') || UNCERTAIN_PHRASE.test(doc.text);
}

function firstParagraphs(text: string, count: number): string {
  return text.split(/\n\s*\n/).slice(0, count).join('\n\n').trim();
}

function precedenceFrom(indexText: string | undefined): string | null {
  const line = indexText?.split(/\r?\n/).find((l) => /preced[eê]ncia/i.test(l));
  return line ? line.replace(/\*\*/g, '').replace(/^.*?preced[eê]ncia[^:]*:\s*/i, '').trim() : null;
}
