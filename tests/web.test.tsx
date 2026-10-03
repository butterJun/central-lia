// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, Member } from '../src/shared/domain.ts';
import { ActivityStatusBadge, DueDate } from '../src/web/components/Badges.tsx';
import { ActivityForm } from '../src/web/components/ActivityForm.tsx';
import { MemberProvider } from '../src/web/member-context.tsx';
import { filterActivities } from '../src/web/pages/ActivitiesPage.tsx';

const MEMBERS: Member[] = [
  { id: 'U-A', displayName: 'Ana', front: 'Growth', role: 'member', description: '' },
  { id: 'U-D', displayName: 'Davi', front: 'Operações', role: 'member', description: '' },
];

function activity(id: string, overrides: Partial<Activity>): Activity {
  return {
    id, title: id, description: '', nextStep: '', ownerIds: [], front: 'Growth', status: 'todo', dueDate: null,
    unresolvedOwners: [], priority: null, notes: null, origin: 'import', createdAt: '', updatedAt: '', createdBy: 'system',
    version: 1, pendingSuggestionIds: [], refs: [], ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MemberProvider>{children}</MemberProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MEMBERS), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('activity filters', () => {
  const list = [
    activity('ACT-1', { ownerIds: ['U-A'], dueDate: '2026-10-05' }),
    activity('ACT-2', { ownerIds: ['U-A', 'U-D'], dueDate: '2026-10-11' }),
    activity('ACT-3', { ownerIds: ['U-D'], status: 'done', dueDate: '2026-10-01' }),
    activity('ACT-4', { ownerIds: ['U-D'], front: 'Operações', status: 'blocked' }),
  ];
  const ids = (filters: Parameters<typeof filterActivities>[1]) => filterActivities(list, filters, '2026-10-06').map((a) => a.id);

  it('"mine" includes shared activities and hides completed ones by default', () => {
    expect(ids({ owner: 'U-D', front: '', status: 'open', due: 'all' })).toEqual(['ACT-2', 'ACT-4']);
  });

  it('filters by front, state and deadline windows, ordering by deadline with undated last', () => {
    expect(ids({ owner: 'all', front: 'Operações', status: 'all', due: 'all' })).toEqual(['ACT-4']);
    expect(ids({ owner: 'all', front: '', status: 'blocked', due: 'all' })).toEqual(['ACT-4']);
    expect(ids({ owner: 'all', front: '', status: 'open', due: 'overdue' })).toEqual(['ACT-1']);
    expect(ids({ owner: 'all', front: '', status: 'all', due: 'week' })).toEqual(['ACT-2']);
    expect(ids({ owner: 'all', front: '', status: 'open', due: 'none' })).toEqual(['ACT-4']);
    expect(ids({ owner: 'all', front: '', status: 'all', due: 'all' })).toEqual(['ACT-3', 'ACT-1', 'ACT-2', 'ACT-4']);
  });
});

describe('accessible states', () => {
  it('status badges carry words, not only color', () => {
    render(<ActivityStatusBadge status="blocked" />);
    expect(screen.getByText('Bloqueada')).toBeTruthy();
  });

  it('missing deadlines are said explicitly', () => {
    render(<DueDate dueDate={null} status="todo" />);
    expect(screen.getByText('Prazo a definir')).toBeTruthy();
  });
});

describe('activity form', () => {
  const empty = { title: '', description: '', nextStep: '', ownerIds: [], front: '', status: 'todo' as const, dueDate: null };

  it('labels every field and reports errors in text, linked to the field', async () => {
    const onSubmit = vi.fn();
    render(<ActivityForm initial={empty} fronts={['Growth']} submitLabel="Criar" busy={false} serverError={null} onSubmit={onSubmit} />, { wrapper });
    const title = screen.getByLabelText('Título');
    expect(screen.getByLabelText('Estado')).toBeTruthy();
    expect(screen.getByLabelText(/Prazo/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    const described = document.getElementById(title.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toMatch(/pelo menos 3 caracteres/);
    expect(screen.getByRole('alert').textContent).toMatch(/Revise o formulário/);
  });

  it('submits valid values with owners chosen by checkbox', async () => {
    const onSubmit = vi.fn();
    render(<ActivityForm initial={empty} fronts={['Growth']} submitLabel="Criar" busy={false} serverError={null} onSubmit={onSubmit} />, { wrapper });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Gravar vídeo' } });
    fireEvent.change(screen.getByLabelText('Frente'), { target: { value: 'Growth' } });
    await waitFor(() => expect(screen.getByLabelText('Davi')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Davi'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Gravar vídeo', front: 'Growth', ownerIds: ['U-D'], dueDate: null }));
  });
});
