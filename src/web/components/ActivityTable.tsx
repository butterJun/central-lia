import { Link } from 'react-router-dom';
import type { Activity } from '../../shared/domain.ts';
import { ownersText } from '../format.ts';
import { useMember } from '../member-context.tsx';
import { ActivityStatusBadge, DueDate, PendingUpdateBadge } from './Badges.tsx';
import { SourceLink } from './SourceLink.tsx';

/** Owner, deadline, state, next step and source in one row — no chain of screens needed. */
export function ActivityTable({ activities, caption }: { activities: Activity[]; caption: string }) {
  const { memberNames } = useMember();
  return (
    <div className="table-wrap">
      <table className="responsive">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Atividade e próximo passo</th>
            <th scope="col">Responsáveis</th>
            <th scope="col">Frente</th>
            <th scope="col">Prazo</th>
            <th scope="col">Estado</th>
            <th scope="col">Fonte</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((activity) => {
            const primarySource = activity.refs[0]?.source;
            return (
              <tr key={activity.id}>
                <td className="cell-title">
                  <Link to={`/atividades/${activity.id}`}>
                    <span className="muted">{activity.id}</span> {activity.title}
                  </Link>
                  <div className="cell-next">Próximo passo: {activity.nextStep || 'não definido'}</div>
                  {activity.pendingSuggestionIds.length > 0 && (
                    <div>
                      <Link to="/sugestoes">
                        <PendingUpdateBadge />
                      </Link>
                    </div>
                  )}
                </td>
                <td data-label="Responsáveis">{ownersText(activity.ownerIds, memberNames, activity.unresolvedOwners)}</td>
                <td data-label="Frente">{activity.front}</td>
                <td data-label="Prazo">
                  <DueDate dueDate={activity.dueDate} status={activity.status} />
                </td>
                <td data-label="Estado">
                  <ActivityStatusBadge status={activity.status} />
                </td>
                <td data-label="Fonte">
                  {primarySource ? <SourceLink source={primarySource} /> : <span className="muted">Criada na interface</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
