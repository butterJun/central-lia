import { Link, useNavigate } from 'react-router-dom';
import { ActivityForm, type ActivityFormValues } from '../components/ActivityForm.tsx';
import { RequireMember } from '../components/States.tsx';
import { useMember } from '../member-context.tsx';
import { useActivities, useCreateActivity } from '../queries.ts';

export function NewActivityPage() {
  return (
    <RequireMember>
      <NewActivityContent />
    </RequireMember>
  );
}

function NewActivityContent() {
  const { member } = useMember();
  const create = useCreateActivity();
  const navigate = useNavigate();
  const activities = useActivities();
  const fronts = [...new Set((activities.data ?? []).map((a) => a.front))];

  const submit = ({ reason: _reason, ...fields }: ActivityFormValues) =>
    create.mutate(fields, { onSuccess: (activity) => navigate(`/atividades/${activity.id}`) });

  return (
    <>
      <p className="small">
        <Link to="/atividades">← Todas as atividades</Link>
      </p>
      <h1>Nova atividade</h1>
      <p className="lead">Será registrada como criada por {member?.displayName}, com data e hora, e passa a valer como registro oficial.</p>
      <section className="card">
        <ActivityForm
          initial={{
            title: '',
            description: '',
            nextStep: '',
            ownerIds: member ? [member.id] : [],
            front: member?.front === 'A definir' ? '' : (member?.front ?? ''),
            status: 'todo',
            dueDate: null,
          }}
          fronts={fronts}
          submitLabel="Criar atividade"
          busy={create.isPending}
          serverError={create.error instanceof Error ? create.error.message : null}
          onSubmit={submit}
          onCancel={() => navigate(-1)}
        />
      </section>
    </>
  );
}
