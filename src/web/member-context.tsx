import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Member } from '../shared/domain.ts';
import { api, setApiMember } from './api.ts';
import type { MemberNames } from './format.ts';
import { useMembers } from './queries.ts';

/**
 * Demo profile selection ("who am I in this demo"). Switching changes what
 * "Minhas atividades" shows, never the activity data itself.
 */

const STORAGE_KEY = 'lia.member';

interface MemberContextValue {
  member: Member | null;
  members: Member[];
  memberNames: MemberNames;
  selectMember: (id: string) => void;
  loading: boolean;
}

const MemberContext = createContext<MemberContextValue | null>(null);

function readStoredMember(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function MemberProvider({ children }: { children: ReactNode }) {
  const membersQuery = useMembers();
  const queryClient = useQueryClient();
  const [memberId, setMemberId] = useState<string | null>(() => {
    const stored = readStoredMember();
    setApiMember(stored);
    return stored;
  });

  const members = membersQuery.data ?? [];
  const member = members.find((candidate) => candidate.id === memberId) ?? null;
  const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  /** A stored profile that no longer exists is forgotten instead of being sent silently. */
  useEffect(() => {
    if (membersQuery.data && memberId && !membersQuery.data.some((candidate) => candidate.id === memberId)) {
      setApiMember(null);
      setMemberId(null);
    }
  }, [membersQuery.data, memberId]);

  useEffect(() => {
    if (!member) return;
    const sessionKey = `lia.visit.${member.id}`;
    try {
      if (window.sessionStorage.getItem(sessionKey)) return;
    } catch {
      // Storage may be unavailable (private mode); the visit is still recorded below.
    }
    api('/api/session/visit', { method: 'POST' })
      .then(() => {
        try {
          window.sessionStorage.setItem(sessionKey, '1');
        } catch {
          // Without storage the visit is recorded again next load; harmless.
        }
        return queryClient.invalidateQueries({ queryKey: ['digest'] });
      })
      .catch(() => undefined);
  }, [member, queryClient]);

  const selectMember = useCallback(
    (id: string) => {
      setApiMember(id);
      setMemberId(id);
      try {
        window.localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // Preference is a convenience; ignore storage failures.
      }
      void queryClient.invalidateQueries({ queryKey: ['digest'] });
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
    [queryClient],
  );

  const value = useMemo(
    () => ({ member, members, memberNames, selectMember, loading: membersQuery.isLoading }),
    [member, members, memberNames, selectMember, membersQuery.isLoading],
  );
  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}

export function useMember(): MemberContextValue {
  const context = useContext(MemberContext);
  if (!context) throw new Error('useMember precisa estar dentro de MemberProvider');
  return context;
}
