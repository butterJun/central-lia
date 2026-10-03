import { useId, useRef, useState, type FormEvent } from 'react';
import { ACTIVITY_STATUS_LABELS, ACTIVITY_STATUSES, type ActivityFields, type ActivityStatus } from '../../shared/domain.ts';
import { activityFieldsSchema } from '../../shared/schemas.ts';
import { useMember } from '../member-context.tsx';

export interface ActivityFormValues extends ActivityFields {
  reason: string;
}

interface Props {
  initial: ActivityFields;
  fronts: string[];
  submitLabel: string;
  busy: boolean;
  serverError: string | null;
  askReason?: boolean;
  onSubmit: (values: ActivityFormValues) => void;
  onCancel?: () => void;
}

type Errors = Partial<Record<keyof ActivityFields, string>>;

export function ActivityForm({ initial, fronts, submitLabel, busy, serverError, askReason = false, onSubmit, onCancel }: Props) {
  const { members } = useMember();
  const [values, setValues] = useState<ActivityFields>(initial);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const summaryRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const fieldId = (name: string) => `${formId}-${name}`;

  const set = <K extends keyof ActivityFields>(key: K, value: ActivityFields[K]) => setValues((current) => ({ ...current, [key]: value }));

  const toggleOwner = (id: string, checked: boolean) =>
    set('ownerIds', checked ? [...values.ownerIds, id] : values.ownerIds.filter((ownerId) => ownerId !== id));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = activityFieldsSchema.safeParse(values);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof ActivityFields] ??= issue.message;
      setErrors(next);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    onSubmit({ ...parsed.data, reason });
  };

  const errorProps = (name: keyof ActivityFields) =>
    errors[name] ? { 'aria-invalid': true as const, 'aria-describedby': fieldId(`${name}-error`) } : {};
  const errorText = (name: keyof ActivityFields) =>
    errors[name] ? (
      <p id={fieldId(`${name}-error`)} className="field-error">
        {errors[name]}
      </p>
    ) : null;
  const errorList = Object.entries(errors);

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={busy}>
      {(errorList.length > 0 || serverError) && (
        <div ref={summaryRef} tabIndex={-1} className="notice notice-error" role="alert">
          <strong>Revise o formulário</strong>
          <ul>
            {errorList.map(([name, message]) => (
              <li key={name}>
                <a href={`#${fieldId(name)}`}>{message}</a>
              </li>
            ))}
            {serverError && <li>{serverError}</li>}
          </ul>
        </div>
      )}
      <div className="field">
        <label htmlFor={fieldId('title')}>Título</label>
        <input id={fieldId('title')} value={values.title} onChange={(e) => set('title', e.target.value)} required {...errorProps('title')} />
        {errorText('title')}
      </div>
      <div className="field">
        <label htmlFor={fieldId('description')}>
          Descrição <span className="hint">(opcional)</span>
        </label>
        <textarea id={fieldId('description')} value={values.description} onChange={(e) => set('description', e.target.value)} {...errorProps('description')} />
        {errorText('description')}
      </div>
      <div className="field">
        <label htmlFor={fieldId('nextStep')}>Próximo passo</label>
        <input id={fieldId('nextStep')} value={values.nextStep} onChange={(e) => set('nextStep', e.target.value)} {...errorProps('nextStep')} />
        {errorText('nextStep')}
      </div>
      <fieldset aria-describedby={errors.ownerIds ? fieldId('ownerIds-error') : undefined}>
        <legend>Responsáveis</legend>
        <div className="checks">
          {members.map((member) => (
            <label key={member.id}>
              <input
                type="checkbox"
                checked={values.ownerIds.includes(member.id)}
                onChange={(e) => toggleOwner(member.id, e.target.checked)}
              />
              {member.displayName}
            </label>
          ))}
        </div>
        <p className="hint">Sem responsável marcado, a atividade aparece como “responsável a confirmar”.</p>
        {errorText('ownerIds')}
      </fieldset>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={fieldId('front')}>Frente</label>
          <input id={fieldId('front')} list={fieldId('fronts')} value={values.front} onChange={(e) => set('front', e.target.value)} {...errorProps('front')} />
          <datalist id={fieldId('fronts')}>
            {fronts.map((front) => (
              <option key={front} value={front} />
            ))}
          </datalist>
          {errorText('front')}
        </div>
        <div className="field">
          <label htmlFor={fieldId('status')}>Estado</label>
          <select id={fieldId('status')} value={values.status} onChange={(e) => set('status', e.target.value as ActivityStatus)}>
            {ACTIVITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ACTIVITY_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={fieldId('dueDate')}>
            Prazo <span className="hint">(opcional; vazio = a definir)</span>
          </label>
          <input
            id={fieldId('dueDate')}
            type="date"
            value={values.dueDate ?? ''}
            onChange={(e) => set('dueDate', e.target.value === '' ? null : e.target.value)}
            {...errorProps('dueDate')}
          />
          {errorText('dueDate')}
        </div>
      </div>
      {askReason && (
        <div className="field">
          <label htmlFor={fieldId('reason')}>
            Motivo da alteração <span className="hint">(opcional, aparece no histórico)</span>
          </label>
          <input id={fieldId('reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
      )}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
