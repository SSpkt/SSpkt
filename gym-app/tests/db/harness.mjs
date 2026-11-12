import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'supabase', 'migrations');

export async function createDatabase() {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, 'supabase-stub.sql'), 'utf8'));
  for (const file of readdirSync(migrationsDir).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  return db;
}

/** Applies every migration a second time; they must be idempotent. */
export async function reapplyMigrations(db) {
  for (const file of readdirSync(migrationsDir).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
}

/** Creates an auth user the way Supabase Auth does, firing the profile trigger. */
export async function signUp(db, email, metadata = {}) {
  await db.exec('set role supabase_auth_admin');
  try {
    const { rows } = await db.query(
      'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
      [email, JSON.stringify(metadata)],
    );
    return rows[0].id;
  } finally {
    await db.exec('reset role');
  }
}

/** Runs `fn` as an API caller: the given Postgres role with the given user id in the JWT. */
export async function asRole(db, role, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    return fn(tx);
  });
}

export const asUser = (db, userId, fn) => asRole(db, 'authenticated', userId, fn);
export const asAnon = (db, fn) => asRole(db, 'anon', null, fn);

/** Runs as the table owner, bypassing RLS — for arranging and inspecting test state only. */
export async function admin(db, sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows;
}
