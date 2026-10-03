import fs from 'node:fs';
import { z } from 'zod';
import { MEMBER_ROLES, type Member } from '../../shared/domain.ts';
import type { Db } from '../db/database.ts';
import { NotFoundError } from '../lib/errors.ts';
import { normalizeForMatch } from '../lib/text.ts';

const membersFileSchema = z.array(
  z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    front: z.string().min(1),
    role: z.enum(MEMBER_ROLES),
    description: z.string().default(''),
  }),
);

/** Demo members are configuration (fictitious people from the case), not Drive data. */
export function loadMembersFile(file: string): Member[] {
  return membersFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

interface MemberRow {
  member_id: string;
  display_name: string;
  front: string;
  role: Member['role'];
  description: string;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.member_id,
    displayName: row.display_name,
    front: row.front,
    role: row.role,
    description: row.description,
  };
}

/** Visits older than this start a new "since your last visit" window. */
const VISIT_SESSION_MS = 30 * 60 * 1000;

export class MembersRepo {
  constructor(private readonly db: Db) {}

  upsertAll(members: Member[]): void {
    const statement = this.db.prepare(
      `INSERT INTO members (member_id, display_name, front, role, description) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET display_name = excluded.display_name, front = excluded.front,
         role = excluded.role, description = excluded.description`,
    );
    for (const member of members) {
      statement.run(member.id, member.displayName, member.front, member.role, member.description);
    }
  }

  list(): Member[] {
    const rows = this.db.prepare('SELECT * FROM members ORDER BY member_id').all() as unknown as MemberRow[];
    return rows.map(toMember);
  }

  get(id: string): Member | undefined {
    const row = this.db.prepare('SELECT * FROM members WHERE member_id = ?').get(id) as MemberRow | undefined;
    return row ? toMember(row) : undefined;
  }

  require(id: string): Member {
    const member = this.get(id);
    if (!member) throw new NotFoundError(`Membro ${id} não encontrado`);
    return member;
  }

  /** Match a free-text name ("Ana", "ana", "U-A") to a member. */
  findByName(name: string): Member | undefined {
    const wanted = normalizeForMatch(name);
    return this.list().find(
      (member) => normalizeForMatch(member.displayName) === wanted || normalizeForMatch(member.id) === wanted,
    );
  }

  displayName(id: string): string {
    if (id === 'system') return 'Sistema (importação)';
    return this.get(id)?.displayName ?? id;
  }

  /** Registers a visit and returns the start of the "what changed" window (previous visit). */
  recordVisit(memberId: string, now: string): { previousVisitAt: string | null } {
    const row = this.db.prepare('SELECT * FROM member_visits WHERE member_id = ?').get(memberId) as
      | { last_visit_at: string; previous_visit_at: string | null }
      | undefined;
    if (!row) {
      this.db
        .prepare('INSERT INTO member_visits (member_id, last_visit_at, previous_visit_at) VALUES (?, ?, NULL)')
        .run(memberId, now);
      return { previousVisitAt: null };
    }
    const isNewSession = Date.parse(now) - Date.parse(row.last_visit_at) > VISIT_SESSION_MS;
    const previous = isNewSession ? row.last_visit_at : row.previous_visit_at;
    this.db
      .prepare('UPDATE member_visits SET last_visit_at = ?, previous_visit_at = ? WHERE member_id = ?')
      .run(now, previous, memberId);
    return { previousVisitAt: previous };
  }

  previousVisit(memberId: string): string | null {
    const row = this.db.prepare('SELECT previous_visit_at FROM member_visits WHERE member_id = ?').get(memberId) as
      | { previous_visit_at: string | null }
      | undefined;
    return row?.previous_visit_at ?? null;
  }
}
