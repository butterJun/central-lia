import { useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../shared/dates.ts';
import {
  ACTIVITY_FIELDS,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
  type ActivityField,
  type ActivityStatus,
  type ProposedFields,
  type Suggestion,
} from '../../shared/domain.ts';
import { ApiError } from '../api.ts';
import { fieldLabel, fieldValueText } from '../format.ts';
import { useMember } from '../member-context.tsx';
import { useReviewSuggestion } from '../queries.ts';
import { SuggestionStatusBadge } from './Badges.tsx';
import { SourceLink } from './SourceLink.tsx';

type Mode = 'view' | 'adjust' | 'reject';

/** Fields to show: for a new activity, empty optional values are omitted. */
function fieldsOf(suggestion: Suggestion): ActivityField[] {
  return ACTIVITY_FIELDS.filter((field) => {
    if (!(field in suggestion.proposed)) return false;
    const value = suggestion.proposed[field];
    return suggestion.kind === 'update' || field === 'dueDate' || field === 'ownerIds' || (value !== '' && value !== null);
  });
}

export function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const { member, memberNames } = useMember();
  const review = useReviewSuggestion(suggestion.id);
  const [mode, setMode] = useState<Mode>('view');
  const [adjusted, setAdjusted] = useState<ProposedFields>(suggestion.proposed);
  const [note, setNote] = useState('');
  const [needsForce, setNeedsForce] = useState(false);
  const headingId = useId();
  const canReview = member?.role === 'reviewer' && suggestion.status === 'pending';
  const fields = fieldsOf(suggestion);
  const errorMessage = review.error instanceof Error ? review.error.message : null;

  const submit = (decision: 'accept' | 'adjust' | 'reject', force = false) => {
    const input =
      decision === 'reject'
        ? { decision, note }
        : decision === 'adjust'
          ? { decision, fields: adjusted, note: note || undefined, force }
          : { decision, force };
    review.mutate(input, {
      onError: (error) =>
        setNeedsForce(error instanceof ApiError && error.status === 409 && Array.isArray((error.details as { fields?: unknown } | null)?.fields)),
    });
  };

  return (
    <article className="card" aria-labelledby={headingId}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 id={headingId} style={{ margin: 0 }}>
          {suggestion.kind === 'update' ? (
            <>
              Atualizar <Link to={`/atividades/${suggestion.targetActivityId}`}>{suggestion.targetActivityId}</Link>
              {suggestion.targetActivityTitle && ` — ${suggestion.targetActivityTitle}`}
            </>
          ) : (
            <>Nova atividade{suggestion.targetActivityId ? ` (${suggestion.targetActivityId})` : ''}</>
          )}
        </h3>
        <SuggestionStatusBadge status={suggestion.status} />
      </div>
      <p className="small muted">
        {suggestion.id} · gerada por {suggestion.generator} em {formatDateTime(suggestion.createdAt)}
        {suggestion.reviewerName && ` · revisada por ${suggestion.reviewerName} em ${formatDateTime(suggestion.reviewedAt)}`}
      </p>

      <table className="diff">
        <caption className="visually-hidden">Campos propostos</caption>
        <thead>
          <tr>
            <th scope="col">Campo</th>
            {suggestion.kind === 'update' && <th scope="col">Oficial agora</th>}
            <th scope="col">Proposto</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field}>
              <th scope="row">{fieldLabel(field)}</th>
              {suggestion.kind === 'update' && <td className="before">{fieldValueText(field, suggestion.baseline[field], memberNames)}</td>}
              <td className="after">{fieldValueText(field, suggestion.proposed[field], memberNames)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="small" style={{ margin: '0.75rem 0 0' }}>
        Evidência
      </h4>
      <blockquote className="evidence">
        <ReactMarkdown skipHtml allowedElements={['p', 'strong', 'em', 'code']} unwrapDisallowed>
          {suggestion.evidence}
        </ReactMarkdown>
      </blockquote>
      <p className="small">
        Fonte: <SourceLink source={suggestion.source} /> · {suggestion.location}
        {suggestion.source.docDate && ` · documento de ${formatDate(suggestion.source.docDate)}`}
      </p>
      <p className="small">
        <strong>Motivo indicado pelo leitor:</strong> {suggestion.reason}
      </p>
      {suggestion.uncertainties.length > 0 && (
        <div className="notice notice-warn">
          <strong>Pontos incertos — confira antes de aceitar</strong>
          <ul>
            {suggestion.uncertainties.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {suggestion.reviewNote && (
        <p className="small">
          <strong>Nota da revisão:</strong> {suggestion.reviewNote}
        </p>
      )}

      {canReview && mode === 'view' && (
        <div className="row">
          <button type="button" onClick={() => submit('accept')} disabled={review.isPending}>
            Aceitar
          </button>
          <button type="button" className="secondary" onClick={() => setMode('adjust')}>
            Ajustar antes de aceitar
          </button>
          <button type="button" className="danger" onClick={() => setMode('reject')}>
            Rejeitar
          </button>
        </div>
      )}
      {canReview && mode === 'adjust' && (
        <AdjustForm fields={fields} values={adjusted} onChange={setAdjusted} note={note} onNote={setNote}>
          <div className="row">
            <button type="button" onClick={() => submit('adjust')} disabled={review.isPending}>
              Aceitar com ajustes
            </button>
            <button type="button" className="secondary" onClick={() => setMode('view')}>
              Voltar
            </button>
          </div>
        </AdjustForm>
      )}
      {canReview && mode === 'reject' && (
        <div className="field">
          <label htmlFor={`${headingId}-reason`}>Motivo da rejeição</label>
          <textarea id={`${headingId}-reason`} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="danger" onClick={() => submit('reject')} disabled={review.isPending || note.trim().length < 3}>
              Confirmar rejeição
            </button>
            <button type="button" className="secondary" onClick={() => setMode('view')}>
              Voltar
            </button>
          </div>
        </div>
      )}
      {suggestion.status === 'pending' && member && member.role !== 'reviewer' && (
        <p className="small muted">Somente perfis revisores (Bruno ou Carla) podem aceitar, ajustar ou rejeitar.</p>
      )}
      <div role="status" aria-live="polite">
        {errorMessage && (
          <div className="notice notice-error">
            {errorMessage}
            {needsForce && (
              <div style={{ marginTop: '0.5rem' }}>
                <button type="button" onClick={() => submit(mode === 'adjust' ? 'adjust' : 'accept', true)}>
                  Aplicar mesmo assim
                </button>
              </div>
            )}
          </div>
        )}
        {review.isSuccess && <div className="notice notice-ok">Revisão registrada.</div>}
      </div>
    </article>
  );
}

interface AdjustProps {
  fields: ActivityField[];
  values: ProposedFields;
  onChange: (values: ProposedFields) => void;
  note: string;
  onNote: (note: string) => void;
  children: React.ReactNode;
}

function AdjustForm({ fields, values, onChange, note, onNote, children }: AdjustProps) {
  const { members } = useMember();
  const id = useId();
  const set = (field: ActivityField, value: unknown) => onChange({ ...values, [field]: value });
  return (
    <fieldset>
      <legend>Ajustar valores propostos</legend>
      {fields.map((field) => (
        <div className="field" key={field}>
          <label htmlFor={`${id}-${field}`}>{fieldLabel(field)}</label>
          {field === 'ownerIds' ? (
            <div className="checks" id={`${id}-${field}`}>
              {members.map((member) => (
                <label key={member.id}>
                  <input
                    type="checkbox"
                    checked={(values.ownerIds ?? []).includes(member.id)}
                    onChange={(e) =>
                      set('ownerIds', e.target.checked ? [...(values.ownerIds ?? []), member.id] : (values.ownerIds ?? []).filter((o) => o !== member.id))
                    }
                  />
                  {member.displayName}
                </label>
              ))}
            </div>
          ) : field === 'status' ? (
            <select id={`${id}-${field}`} value={values.status} onChange={(e) => set('status', e.target.value as ActivityStatus)}>
              {ACTIVITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ACTIVITY_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          ) : field === 'dueDate' ? (
            <input id={`${id}-${field}`} type="date" value={values.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
          ) : (
            <input id={`${id}-${field}`} value={String(values[field] ?? '')} onChange={(e) => set(field, e.target.value)} />
          )}
        </div>
      ))}
      <div className="field">
        <label htmlFor={`${id}-note`}>
          Nota da revisão <span className="hint">(opcional)</span>
        </label>
        <input id={`${id}-note`} value={note} onChange={(e) => onNote(e.target.value)} />
      </div>
      {children}
    </fieldset>
  );
}
