import { z } from 'zod';
import { ACTIVITY_STATUSES, type Activity, type IgnoredItem, type Member, type ProposedFields } from '../../shared/domain.ts';

/**
 * Contract between a minutes analyzer (Claude or the deterministic heuristic)
 * and the rest of the system. It mirrors section 6 of the technical spec. The
 * analyzer output is untrusted: `validator.ts` checks every field against the
 * document and the official records before anything becomes a suggestion.
 */

export const rawProposalSchema = z.object({
  kind: z.enum(['create', 'update', 'no_action']),
  target_activity_id: z.string().nullable(),
  title: z.string().nullable(),
  owners: z.array(z.string()),
  due_date: z.string().nullable(),
  next_step: z.string().nullable(),
  status: z.enum(ACTIVITY_STATUSES).nullable(),
  evidence: z.string(),
  reason: z.string(),
  uncertainties: z.array(z.string()),
});
export type RawProposal = z.infer<typeof rawProposalSchema>;

export const analyzerOutputSchema = z.object({
  proposals: z.array(rawProposalSchema),
});

export interface AnalyzerInput {
  documentName: string;
  documentDate: string | null;
  documentText: string;
  activities: Activity[];
  members: Member[];
}

export interface AnalyzerOutput {
  proposals: RawProposal[];
  generator: string;
  warnings: string[];
}

export interface MinutesAnalyzer {
  readonly name: string;
  analyze(input: AnalyzerInput): Promise<AnalyzerOutput>;
}

/** A validated proposal, ready to be stored as a pending suggestion. */
export interface SuggestionDraft {
  kind: 'create' | 'update';
  /** For updates, the activity to change; for creates, an id requested by the source (e.g. a new registry row). */
  targetActivityId: string | null;
  proposed: ProposedFields;
  baseline: ProposedFields;
  evidence: string;
  location: string;
  reason: string;
  uncertainties: string[];
  possibleDuplicateOf: string | null;
}

export interface ValidationResult {
  drafts: SuggestionDraft[];
  ignored: IgnoredItem[];
}
