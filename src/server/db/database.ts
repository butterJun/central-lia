import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.ts';

export type Db = DatabaseSync;

/** Opens (and migrates) the SQLite database. Use ':memory:' in tests. */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  runMigrations(db);
  return db;
}

const depthByDb = new WeakMap<Db, number>();

/**
 * Runs `work` atomically. Nested calls become savepoints, so services can
 * compose without caring whether a transaction is already open.
 */
export function transaction<T>(db: Db, work: () => T): T {
  const depth = depthByDb.get(db) ?? 0;
  const savepoint = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  depthByDb.set(db, depth + 1);
  try {
    const result = work();
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw error;
  } finally {
    depthByDb.set(db, depth);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
