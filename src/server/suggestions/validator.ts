import type { Activity, IgnoredItem, Member, ProposedFields } from '../../shared/domain.ts';
import { isIsoDate } from '../../shared/dates.ts';
import { diffFields, pickFields } from '../activities/activity-service.ts';
import {
  contentTokens,
  isEquivalentText,
  normalizeForEvidence,
  normalizeForMatch,
  tokenSimilarity,
  truncate,
} from '../lib/text.ts';
import type { RawProposal, SuggestionDraft, ValidationResult } from './contract.ts';

/**
 * Deterministic gate between any analyzer (LLM or heuristic) and the database.
 * A proposal only becomes a suggestion if its evidence is a literal excerpt of
 * the document, its target exists, and every proposed value can be traced to
 * that excerpt. Values that cannot be traced are dropped and flagged — never
 * invented. Proposals that change nothing are discarded.
 */

export interface ValidationContext {
  documentText: string;
  documentDate: string | null;
  activities: Activity[];
  members: Member[];
  /** Latest human-approved change of an activity, to flag documents older than it. */
  lastHumanChangeAt: (activityId: string) => string | null;
}

const HEDGE = /\b(talvez|quem sabe|poder[ií]amos|pode ser que|ideia|hip[oó]tese|sem decis[aã]o|ningu[eé]m assumiu|n[aã]o foi decidid|a confirmar|sugest[aã]o de)\b/i;
const ACTIVITY_ID = /\bACT-\d+\b/g;
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DUPLICATE_SIMILARITY = 0.5;
const MAX_EVIDENCE_CHARS = 600;
const MIN_ANCHOR_RATIO = 0.6;
const MIN_EVIDENCE_CHARS = 15;
const MIN_EVIDENCE_WORDS = 3;
const NEGATED_STATUS = /\bnao\s+(?:esta\s+|foi\s+|ficou\s+)?(?:conclu|bloque|finaliz|entreg)/;

export function validateProposals(proposals: RawProposal[], context: ValidationContext): ValidationResult {
  const normalizedDocument = normalizeForEvidence(context.documentText);
  const drafts: SuggestionDraft[] = [];
  const ignored: IgnoredItem[] = [];
  for (const proposal of proposals) {
    const outcome = validateOne(proposal, context, normalizedDocument);
    if ('draft' in outcome) drafts.push(outcome.draft);
    else ignored.push(outcome.ignored);
  }
  return { drafts: dedupeDrafts(drafts), ignored };
}

type Outcome = { draft: SuggestionDraft } | { ignored: IgnoredItem };

function reject(proposal: RawProposal, reason: string): Outcome {
  return { ignored: { text: truncate(proposal.evidence || proposal.title || '(sem trecho)', 300), reason } };
}

function validateOne(proposal: RawProposal, context: ValidationContext, normalizedDocument: string): Outcome {
  const evidence = proposal.evidence.trim();
  if (proposal.kind === 'no_action') {
    return reject(proposal, proposal.reason || 'Sem decisão ou ação atribuída: não vira atividade.');
  }
  if (!evidence || !normalizedDocument.includes(normalizeForEvidence(evidence))) {
    return reject(proposal, 'Descartada: o trecho de evidência não foi encontrado literalmente no documento.');
  }
  if (evidence.length < MIN_EVIDENCE_CHARS || contentTokens(evidence).size < MIN_EVIDENCE_WORDS) {
    return reject(proposal, 'Descartada: trecho de evidência curto demais para sustentar a proposta.');
  }
  const uncertainties = [...proposal.uncertainties.map((item) => item.trim()).filter(Boolean)];
  const target = resolveTarget(proposal, context.activities);
  if (proposal.kind === 'update' && !target) {
    return reject(proposal, `Descartada: a atividade ${proposal.target_activity_id ?? '(não informada)'} não existe no registro.`);
  }
  if (!target && HEDGE.test(evidence)) {
    return reject(proposal, 'Hipótese ou ideia sem decisão: não vira atividade oficial.');
  }
  if (HEDGE.test(evidence)) uncertainties.push('O trecho contém linguagem de hipótese ou pendência ("talvez", "a confirmar"...).');

  const fields = traceFields(proposal, evidence, context.members, uncertainties);
  return target
    ? buildUpdate(proposal, target, fields, evidence, uncertainties, context)
    : buildCreate(proposal, fields, evidence, uncertainties, context);
}

function resolveTarget(proposal: RawProposal, activities: Activity[]): Activity | undefined {
  const byId = (id: string | null | undefined) => (id ? activities.find((a) => a.id === id.trim().toUpperCase()) : undefined);
  const explicit = byId(proposal.target_activity_id);
  if (explicit) return explicit;
  const mentioned = [...new Set(proposal.evidence.toUpperCase().match(ACTIVITY_ID) ?? [])];
  return mentioned.length === 1 ? byId(mentioned[0]) : undefined;
}

/** Keeps only values that can be traced to the evidence excerpt. */
function traceFields(proposal: RawProposal, evidence: string, members: Member[], uncertainties: string[]): ProposedFields {
  const fields: ProposedFields = {};
  const ownerIds = traceOwners(proposal.owners, evidence, members, uncertainties);
  if (ownerIds.length > 0) fields.ownerIds = ownerIds;

  if (proposal.due_date) {
    const due = proposal.due_date.trim().slice(0, 10);
    if (!isIsoDate(due)) uncertainties.push(`Prazo "${proposal.due_date}" ignorado: não é uma data válida.`);
    else if (!dateMentioned(evidence, due)) uncertainties.push('Prazo sugerido não aparece explicitamente no trecho; deixado em aberto.');
    else fields.dueDate = due;
  }
  if (proposal.next_step?.trim()) {
    fields.nextStep = truncate(proposal.next_step.trim(), 500);
    if (!anchoredIn(fields.nextStep, evidence)) uncertainties.push('Próximo passo redigido pelo leitor, não copiado do trecho; confira.');
  }
  if (proposal.status) {
    if (statusMentioned(evidence, proposal.status)) fields.status = proposal.status;
    else uncertainties.push('Mudança de estado não está explícita no trecho; ignorada.');
  }
  if (proposal.title?.trim()) fields.title = truncate(proposal.title.trim(), 160);
  return fields;
}

function traceOwners(names: string[], evidence: string, members: Member[], uncertainties: string[]): string[] {
  const normalizedEvidence = ` ${normalizeForMatch(evidence).replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
  const ids: string[] = [];
  for (const name of names) {
    const wanted = normalizeForMatch(name);
    const member = members.find((m) => normalizeForMatch(m.displayName) === wanted || normalizeForMatch(m.id) === wanted);
    if (!member) {
      uncertainties.push(`Responsável "${name}" não corresponde a um membro cadastrado: a confirmar.`);
    } else if (!normalizedEvidence.includes(` ${normalizeForMatch(member.displayName)} `)) {
      uncertainties.push(`Responsável ${member.displayName} não aparece no trecho; deixado em aberto.`);
    } else if (!ids.includes(member.id)) {
      ids.push(member.id);
    }
  }
  return ids;
}

/** Most content words of `text` appear in the evidence (not invented wording). */
function anchoredIn(text: string, evidence: string): boolean {
  const words = [...contentTokens(text)];
  if (words.length === 0) return true;
  const evidenceWords = contentTokens(evidence);
  return words.filter((word) => evidenceWords.has(word)).length / words.length >= MIN_ANCHOR_RATIO;
}

export function dateMentioned(evidence: string, iso: string): boolean {
  const text = normalizeForMatch(evidence);
  const [year, month, day] = iso.split('-');
  if (text.includes(iso)) return true;
  const d = String(Number(day));
  const m = String(Number(month));
  const slashed = new RegExp(`\\b0?${d}/0?${m}(?:/(\\d{2,4}))?\\b`, 'g');
  for (const match of text.matchAll(slashed)) {
    const writtenYear = match[1];
    if (!writtenYear || writtenYear === year || writtenYear === year?.slice(2)) return true;
  }
  const monthName = MONTHS[Number(month) - 1];
  return new RegExp(`\\b0?${d}(º)? de ${monthName}\\b`).test(text);
}

function statusMentioned(evidence: string, status: string): boolean {
  const text = normalizeForMatch(evidence);
  if (NEGATED_STATUS.test(text)) return false;
  const patterns: Record<string, RegExp> = {
    blocked: /bloquead|impedid|travad/,
    done: /conclu|finalizad|entregue|encerrad/,
    in_progress: /em andamento|iniciad|comecou|em execucao/,
    todo: /a fazer|reabert|pendente/,
  };
  return patterns[status]?.test(text) ?? false;
}

function locate(documentText: string, evidence: string): string {
  const probe = normalizeForEvidence(evidence).slice(0, 40);
  let heading = '';
  for (const line of documentText.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (match) heading = (match[1] ?? '').trim();
    if (probe && normalizeForEvidence(line).includes(probe)) {
      return heading ? `Seção "${heading}"` : 'Início do documento';
    }
  }
  return heading ? `Seção "${heading}"` : 'Documento';
}

function flagOutdatedDocument(target: Activity, context: ValidationContext, uncertainties: string[]): void {
  const lastChange = context.lastHumanChangeAt(target.id);
  if (context.documentDate && lastChange && context.documentDate < lastChange.slice(0, 10)) {
    uncertainties.push(
      `Documento de ${context.documentDate} é anterior à última alteração aprovada de ${target.id} (${lastChange.slice(0, 10)}); pode estar desatualizado.`,
    );
  }
}

function buildUpdate(
  proposal: RawProposal,
  target: Activity,
  traced: ProposedFields,
  evidence: string,
  uncertainties: string[],
  context: ValidationContext,
): Outcome {
  const current = pickFields(target);
  const { title: _ignoredTitle, ...candidate } = traced;
  if (candidate.nextStep && isEquivalentText(candidate.nextStep, current.nextStep)) delete candidate.nextStep;
  const changes = diffFields(current, candidate);
  if (changes.length === 0) {
    return reject(proposal, `Confirma o registro atual de ${target.id}; nenhuma mudança a propor.`);
  }
  const proposed = Object.fromEntries(changes.map((change) => [change.field, change.after])) as ProposedFields;
  const baseline = Object.fromEntries(changes.map((change) => [change.field, change.before])) as ProposedFields;
  flagOutdatedDocument(target, context, uncertainties);
  return {
    draft: {
      kind: 'update',
      targetActivityId: target.id,
      proposed,
      baseline,
      evidence: truncate(evidence, MAX_EVIDENCE_CHARS),
      location: locate(context.documentText, evidence),
      reason: proposal.reason || `Documento propõe alterar ${target.id}.`,
      uncertainties: [...new Set(uncertainties)],
      possibleDuplicateOf: null,
    },
  };
}

function buildCreate(
  proposal: RawProposal,
  traced: ProposedFields,
  evidence: string,
  uncertainties: string[],
  context: ValidationContext,
): Outcome {
  if (!traced.title) return reject(proposal, 'Descartada: proposta de nova atividade sem título.');
  const owners = traced.ownerIds ?? [];
  if (owners.length === 0) uncertainties.push('Responsável a confirmar: o trecho não indica quem assume.');
  if (!traced.dueDate) uncertainties.push('Prazo a definir: o trecho não traz data explícita.');
  const ownerFront = context.members.find((member) => member.id === owners[0])?.front;
  if (ownerFront) uncertainties.push(`Frente inferida a partir do responsável (${ownerFront}); confirme.`);
  const duplicate = findSimilarActivity(traced.title, owners, context.activities);
  if (duplicate) uncertainties.push(`Parece repetir ${duplicate.id} ("${duplicate.title}"); verifique se é duplicata.`);
  return {
    draft: {
      kind: 'create',
      targetActivityId: null,
      proposed: {
        title: traced.title,
        description: '',
        nextStep: traced.nextStep ?? '',
        ownerIds: owners,
        front: ownerFront ?? 'A definir',
        status: traced.status ?? 'todo',
        dueDate: traced.dueDate ?? null,
      },
      baseline: {},
      evidence: truncate(evidence, MAX_EVIDENCE_CHARS),
      location: locate(context.documentText, evidence),
      reason: proposal.reason || 'Documento registra uma nova ação com responsável.',
      uncertainties: [...new Set(uncertainties)],
      possibleDuplicateOf: duplicate?.id ?? null,
    },
  };
}

function findSimilarActivity(title: string, ownerIds: string[], activities: Activity[]): Activity | undefined {
  return activities.find((activity) => {
    const similarity = tokenSimilarity(title, activity.title);
    const sharesOwner = ownerIds.some((id) => activity.ownerIds.includes(id));
    return similarity >= 0.75 || (sharesOwner && similarity >= DUPLICATE_SIMILARITY);
  });
}

/** Two proposals for the same target and the same values are one suggestion. */
function dedupeDrafts(drafts: SuggestionDraft[]): SuggestionDraft[] {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = `${draft.kind}|${draft.targetActivityId ?? draft.proposed.title}|${JSON.stringify(draft.proposed)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
