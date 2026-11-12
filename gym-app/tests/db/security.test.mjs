import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { admin, asAnon, asUser, createDatabase, reapplyMigrations, signUp } from './harness.mjs';

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

let db;
/** trainerA has clients c1 + c2, trainerB has c3, c4 is unlinked. */
let trainerA, trainerB, c1, c2, c3, c4;
let codeA, codeB;

const one = async (sql, params) => (await admin(db, sql, params))[0];
const query = (userId, sql, params = []) => asUser(db, userId, async (tx) => (await tx.query(sql, params)).rows);
const rpc = async (userId, sql, params = []) => Object.values((await query(userId, sql, params))[0])[0];
const denied = (userId, sql, params, pattern) => assert.rejects(query(userId, sql, params), pattern);

before(async () => {
  db = await createDatabase();
  trainerA = await signUp(db, 'a@gym.test', { role: 'trainer', full_name: 'Trainer A' });
  trainerB = await signUp(db, 'b@gym.test', { role: 'trainer', full_name: 'Trainer B' });
  c1 = await signUp(db, 'c1@gym.test', { role: 'client', full_name: 'Client One' });
  c2 = await signUp(db, 'c2@gym.test', { full_name: 'Client Two' });
  c3 = await signUp(db, 'c3@gym.test', { role: 'client', full_name: 'Client Three' });
  c4 = await signUp(db, 'c4@gym.test', { role: 'client', full_name: 'Client Four' });
  codeA = (await one('select invite_code from public.profiles where id = $1', [trainerA])).invite_code;
  codeB = (await one('select invite_code from public.profiles where id = $1', [trainerB])).invite_code;
  assert.equal((await rpc(c1, 'select public.join_trainer($1)', [codeA])).ok, true);
  assert.equal((await rpc(c2, 'select public.join_trainer($1)', [codeA])).ok, true);
  assert.equal((await rpc(c3, 'select public.join_trainer($1)', [codeB])).ok, true);
});

describe('profile auto-provisioning', () => {
  it('creates a profile for every new auth user, even though the auth role cannot call the function directly', async () => {
    const profile = await one('select * from public.profiles where id = $1', [c1]);
    assert.equal(profile.email, 'c1@gym.test');
    assert.equal(profile.full_name, 'Client One');
    assert.equal(profile.role, 'client');
    assert.equal(profile.invite_code, null);
  });

  it('defaults to client and refuses any role that is not explicitly trainer', async () => {
    assert.equal((await one('select role from public.profiles where id = $1', [c2])).role, 'client');
    for (const role of ['admin', 'service_role', 'TRAINER', '', 'trainer ']) {
      const id = await signUp(db, `role-${Math.random()}@gym.test`, { role });
      assert.equal((await one('select role from public.profiles where id = $1', [id])).role, 'client');
    }
  });

  it('gives each trainer a unique 10-character invite code', async () => {
    assert.match(codeA, /^[0-9A-F]{10}$/);
    assert.match(codeB, /^[0-9A-F]{10}$/);
    assert.notEqual(codeA, codeB);
  });

  it('sanitises and truncates the display name', async () => {
    const id = await signUp(db, 'long@gym.test', { full_name: `  Eve\u0007\n${'x'.repeat(200)}` });
    const { full_name } = await one('select full_name from public.profiles where id = $1', [id]);
    assert.equal(full_name.length, 80);
    assert.ok(full_name.startsWith('Evexx'));
  });

  it('keeps the profile email in sync with the auth email', async () => {
    const id = await signUp(db, 'old@gym.test', {});
    await admin(db, "update auth.users set email = 'new@gym.test' where id = $1", [id]);
    assert.equal((await one('select email from public.profiles where id = $1', [id])).email, 'new@gym.test');
  });
});

describe('anonymous callers', () => {
  it('cannot read or write any table', async () => {
    for (const table of ['profiles', 'workouts', 'subscriptions']) {
      await assert.rejects(
        asAnon(db, (tx) => tx.query(`select * from public.${table}`)),
        /permission denied/,
      );
    }
    await assert.rejects(
      asAnon(db, (tx) => tx.query("insert into public.profiles (id, role) values (gen_random_uuid(), 'trainer')")),
      /permission denied/,
    );
  });

  it('cannot call any RPC or helper', async () => {
    const calls = [
      "select public.join_trainer('ABC')",
      'select public.leave_trainer()',
      `select public.remove_client('${RANDOM_UUID}')`,
      'select public.regenerate_invite_code()',
      'select public.my_plan()',
      'select public.delete_my_account()',
      'select private.is_trainer()',
    ];
    for (const sql of calls) {
      await assert.rejects(asAnon(db, (tx) => tx.query(sql)), /permission denied/, sql);
    }
  });
});

describe('profiles: tenant isolation', () => {
  it('a trainer sees only their own linked clients', async () => {
    const rows = await query(trainerA, "select id from public.profiles where role = 'client' order by email");
    assert.deepEqual(rows.map((r) => r.id), [c1, c2]);
  });

  it('a trainer cannot see another trainer, their clients, or unlinked clients', async () => {
    const rows = await query(trainerA, 'select id from public.profiles where id = any($1)', [[trainerB, c3, c4]]);
    assert.equal(rows.length, 0);
  });

  it('a client sees only themselves and their own trainer', async () => {
    const rows = await query(c1, 'select id from public.profiles order by role, email');
    assert.deepEqual(rows.map((r) => r.id), [c1, trainerA]);
  });

  it('an unlinked client sees only themselves', async () => {
    const rows = await query(c4, 'select id from public.profiles');
    assert.deepEqual(rows.map((r) => r.id), [c4]);
  });

  it("a user registering as a trainer gains no access to anyone else's data", async () => {
    const mallory = await signUp(db, 'mallory@gym.test', { role: 'trainer' });
    const rows = await query(mallory, 'select id from public.profiles');
    assert.deepEqual(rows.map((r) => r.id), [mallory]);
    assert.equal((await query(mallory, 'select id from public.workouts')).length, 0);
  });
});

describe('profiles: privilege escalation', () => {
  it('nobody can change their own role, trainer link, invite code, email or id', async () => {
    const attempts = [
      ["update public.profiles set role = 'trainer' where id = $1", [c1]],
      ['update public.profiles set trainer_id = $2 where id = $1', [c4, trainerA]],
      ["update public.profiles set invite_code = 'AAAAAAAAAA' where id = $1", [trainerA]],
      ["update public.profiles set email = 'x@evil.test' where id = $1", [c1]],
      ['update public.profiles set id = $2 where id = $1', [c1, RANDOM_UUID]],
    ];
    for (const [sql, params] of attempts) {
      await denied(params[0], sql, params, /permission denied/);
    }
    assert.equal((await one('select role from public.profiles where id = $1', [c1])).role, 'client');
  });

  it('nobody can insert or delete profile rows directly', async () => {
    await denied(c1, "insert into public.profiles (id, role) values ($1, 'trainer')", [RANDOM_UUID], /permission denied/);
    await denied(c1, 'delete from public.profiles where id = $1', [c1], /permission denied/);
  });

  it('a user can rename themselves but nobody else', async () => {
    await query(c1, "update public.profiles set full_name = 'Renamed' where id = $1", [c1]);
    assert.equal((await one('select full_name from public.profiles where id = $1', [c1])).full_name, 'Renamed');

    // The trainer can see c1, but the update policy still filters the row out.
    await query(trainerA, "update public.profiles set full_name = 'Hacked' where id = $1", [c1]);
    await query(c2, "update public.profiles set full_name = 'Hacked' where id = $1", [trainerA]);
    assert.equal((await one('select full_name from public.profiles where id = $1', [c1])).full_name, 'Renamed');
    assert.equal((await one('select full_name from public.profiles where id = $1', [trainerA])).full_name, 'Trainer A');
  });

  it('rejects over-long names', async () => {
    await denied(c1, 'update public.profiles set full_name = $2 where id = $1', [c1, 'x'.repeat(81)], /profiles_full_name_len/);
  });
});

describe('join_trainer', () => {
  it('rejects unknown codes and trainers trying to join', async () => {
    assert.deepEqual(await rpc(c4, "select public.join_trainer('NOPE000000')"), { ok: false, error: 'INVALID_CODE' });
    assert.deepEqual(await rpc(c4, "select public.join_trainer('')"), { ok: false, error: 'INVALID_CODE' });
    assert.deepEqual(await rpc(c4, 'select public.join_trainer(null)'), { ok: false, error: 'INVALID_CODE' });
    assert.deepEqual(await rpc(trainerB, 'select public.join_trainer($1)', [codeA]), { ok: false, error: 'NOT_A_CLIENT' });
  });

  it('accepts codes typed in lower case with separators', async () => {
    const id = await signUp(db, 'messy@gym.test', {});
    const typed = ` ${codeB.slice(0, 5).toLowerCase()}-${codeB.slice(5).toLowerCase()} `;
    assert.equal((await rpc(id, 'select public.join_trainer($1)', [typed])).ok, true);
    assert.equal((await one('select trainer_id from public.profiles where id = $1', [id])).trainer_id, trainerB);
  });

  it('refuses a second link while already linked', async () => {
    assert.deepEqual(await rpc(c1, 'select public.join_trainer($1)', [codeB]), { ok: false, error: 'ALREADY_LINKED' });
    assert.equal((await one('select trainer_id from public.profiles where id = $1', [c1])).trainer_id, trainerA);
  });

  it('locks out code guessing after 10 wrong attempts in an hour', async () => {
    const guesser = await signUp(db, 'guesser@gym.test', {});
    for (let i = 0; i < 10; i++) {
      assert.equal((await rpc(guesser, "select public.join_trainer('BAD0000000')")).error, 'INVALID_CODE');
    }
    // Even the correct code is refused once locked out.
    assert.deepEqual(await rpc(guesser, 'select public.join_trainer($1)', [codeB]), { ok: false, error: 'TOO_MANY_ATTEMPTS' });

    await admin(db, "update private.join_attempts set attempted_at = now() - interval '2 hours' where user_id = $1", [guesser]);
    assert.equal((await rpc(guesser, 'select public.join_trainer($1)', [codeB])).ok, true);
  });

  it('enforces the free-plan client limit and lifts it for paying trainers', async () => {
    const trainer = await signUp(db, 'cap@gym.test', { role: 'trainer' });
    const { invite_code: code } = await one('select invite_code from public.profiles where id = $1', [trainer]);
    for (let i = 0; i < 3; i++) {
      const client = await signUp(db, `cap-client-${i}@gym.test`, {});
      assert.equal((await rpc(client, 'select public.join_trainer($1)', [code])).ok, true);
    }
    const fourth = await signUp(db, 'cap-client-4@gym.test', {});
    assert.deepEqual(await rpc(fourth, 'select public.join_trainer($1)', [code]), { ok: false, error: 'TRAINER_AT_CAPACITY' });
    assert.deepEqual(await rpc(trainer, 'select public.my_plan()'), {
      plan: 'free', status: 'inactive', client_count: 3, client_limit: 3,
      current_period_end: null, cancel_at_period_end: false,
    });

    for (const status of ['canceled', 'past_due', 'incomplete']) {
      await admin(db, `insert into public.subscriptions (user_id, status) values ($1, $2)
        on conflict (user_id) do update set status = excluded.status`, [trainer, status]);
      assert.equal((await rpc(fourth, 'select public.join_trainer($1)', [code])).error, 'TRAINER_AT_CAPACITY', status);
    }

    await admin(db, "update public.subscriptions set status = 'active' where user_id = $1", [trainer]);
    assert.equal((await rpc(fourth, 'select public.join_trainer($1)', [code])).ok, true);
    const plan = await rpc(trainer, 'select public.my_plan()');
    assert.equal(plan.plan, 'pro');
    assert.equal(plan.client_count, 4);
    assert.equal(plan.client_limit, null);
  });
});

describe('workouts', () => {
  let workoutC1, workoutC3;

  before(async () => {
    workoutC1 = (await query(
      trainerA,
      'insert into public.workouts (trainer_id, client_id, title, notes) values ($1, $2, $3, $4) returning *',
      [trainerA, c1, 'Leg day', '5x5 squats'],
    ))[0];
    workoutC3 = (await query(
      trainerB,
      'insert into public.workouts (trainer_id, client_id, title) values ($1, $2, $3) returning *',
      [trainerB, c3, 'Push day'],
    ))[0];
  });

  it('a trainer can assign a workout to their own client', async () => {
    assert.equal(workoutC1.is_completed, false);
    assert.equal(workoutC1.completed_at, null);
    assert.equal(workoutC1.notes, '5x5 squats');
  });

  it("a trainer cannot assign to another trainer's client, an unlinked client, or another trainer", async () => {
    for (const target of [c3, c4, trainerB, trainerA]) {
      await denied(
        trainerA,
        "insert into public.workouts (trainer_id, client_id, title) values ($1, $2, 'x')",
        [trainerA, target],
        /row-level security/,
      );
    }
  });

  it('a trainer cannot forge the trainer_id of a workout', async () => {
    await denied(
      trainerA,
      "insert into public.workouts (trainer_id, client_id, title) values ($1, $2, 'x')",
      [trainerB, c3],
      /row-level security/,
    );
  });

  it('a client cannot create workouts, even for themselves', async () => {
    await denied(c1, "insert into public.workouts (trainer_id, client_id, title) values ($1, $1, 'x')", [c1], /row-level security/);
    await denied(c1, "insert into public.workouts (trainer_id, client_id, title) values ($2, $1, 'x')", [c1, trainerA], /row-level security/);
  });

  it('server-controlled columns cannot be supplied on insert', async () => {
    await denied(
      trainerA,
      "insert into public.workouts (trainer_id, client_id, title, is_completed) values ($1, $2, 'x', true)",
      [trainerA, c1],
      /permission denied/,
    );
    await denied(
      trainerA,
      "insert into public.workouts (trainer_id, client_id, title, completed_at) values ($1, $2, 'x', now())",
      [trainerA, c1],
      /permission denied/,
    );
  });

  it('validates title and notes length', async () => {
    const insert = 'insert into public.workouts (trainer_id, client_id, title, notes) values ($1, $2, $3, $4)';
    await denied(trainerA, insert, [trainerA, c1, '   ', ''], /workouts_title_len/);
    await denied(trainerA, insert, [trainerA, c1, 'x'.repeat(121), ''], /workouts_title_len/);
    await denied(trainerA, insert, [trainerA, c1, 'ok', 'x'.repeat(4001)], /workouts_notes_len/);
  });

  it('each party sees only their own workouts', async () => {
    assert.deepEqual((await query(c1, 'select id from public.workouts')).map((r) => r.id), [workoutC1.id]);
    assert.deepEqual((await query(c3, 'select id from public.workouts')).map((r) => r.id), [workoutC3.id]);
    assert.deepEqual((await query(trainerA, 'select id from public.workouts')).map((r) => r.id), [workoutC1.id]);
    assert.equal((await query(c2, 'select id from public.workouts')).length, 0);
    assert.equal((await query(c4, 'select id from public.workouts')).length, 0);
  });

  it('a client can tick and untick their workout, with the timestamp set by the server', async () => {
    let row = (await query(c1, 'update public.workouts set is_completed = true where id = $1 returning *', [workoutC1.id]))[0];
    assert.equal(row.is_completed, true);
    assert.ok(row.completed_at instanceof Date);

    row = (await query(c1, 'update public.workouts set is_completed = false where id = $1 returning *', [workoutC1.id]))[0];
    assert.equal(row.is_completed, false);
    assert.equal(row.completed_at, null);
  });

  it('a client cannot edit the content, ownership or timestamps of a workout', async () => {
    await denied(c1, "update public.workouts set title = 'Rest day' where id = $1", [workoutC1.id], /Clients can only mark workouts complete/);
    await denied(c1, "update public.workouts set notes = 'none' where id = $1", [workoutC1.id], /Clients can only mark workouts complete/);
    await denied(c1, 'update public.workouts set client_id = $2 where id = $1', [workoutC1.id, c2], /permission denied/);
    await denied(c1, 'update public.workouts set trainer_id = $2 where id = $1', [workoutC1.id, c1], /permission denied/);
    await denied(c1, 'update public.workouts set completed_at = now() where id = $1', [workoutC1.id], /permission denied/);
    await denied(c1, 'update public.workouts set created_at = now() where id = $1', [workoutC1.id], /permission denied/);
  });

  it("nobody can touch a workout that isn't theirs", async () => {
    for (const intruder of [c2, c3, c4, trainerB]) {
      await query(intruder, 'update public.workouts set is_completed = true where id = $1', [workoutC1.id]);
      await query(intruder, 'delete from public.workouts where id = $1', [workoutC1.id]);
    }
    const row = await one('select is_completed from public.workouts where id = $1', [workoutC1.id]);
    assert.equal(row.is_completed, false);
  });

  it('a client cannot delete their own workout; the trainer can edit and delete it', async () => {
    await query(c1, 'delete from public.workouts where id = $1', [workoutC1.id]);
    assert.ok(await one('select 1 as present from public.workouts where id = $1', [workoutC1.id]));

    const edited = (await query(trainerA, "update public.workouts set title = 'Leg day v2' where id = $1 returning title", [workoutC1.id]))[0];
    assert.equal(edited.title, 'Leg day v2');

    const temp = (await query(
      trainerA,
      "insert into public.workouts (trainer_id, client_id, title) values ($1, $2, 'temp') returning id",
      [trainerA, c2],
    ))[0];
    await query(trainerA, 'delete from public.workouts where id = $1', [temp.id]);
    assert.equal(await one('select 1 as present from public.workouts where id = $1', [temp.id]), undefined);
  });
});

describe('subscriptions', () => {
  it('users cannot grant themselves a paid plan', async () => {
    await denied(trainerA, "insert into public.subscriptions (user_id, status) values ($1, 'active')", [trainerA], /permission denied/);
    await admin(db, "insert into public.subscriptions (user_id, status, stripe_customer_id) values ($1, 'canceled', 'cus_a')", [trainerA]);
    await denied(trainerA, "update public.subscriptions set status = 'active' where user_id = $1", [trainerA], /permission denied/);
    await denied(trainerA, 'delete from public.subscriptions where user_id = $1', [trainerA], /permission denied/);
    assert.equal((await rpc(trainerA, 'select public.my_plan()')).plan, 'free');
  });

  it('users can read only their own subscription', async () => {
    assert.equal((await query(trainerA, 'select * from public.subscriptions')).length, 1);
    assert.equal((await query(trainerB, 'select * from public.subscriptions')).length, 0);
    assert.equal((await query(c1, 'select * from public.subscriptions')).length, 0);
  });
});

describe('relationship management', () => {
  it("a trainer cannot remove another trainer's client", async () => {
    assert.equal(await rpc(trainerA, 'select public.remove_client($1)', [c3]), false);
    assert.equal((await one('select trainer_id from public.profiles where id = $1', [c3])).trainer_id, trainerB);
  });

  it('a trainer can remove their own client, who then loses sight of the trainer', async () => {
    const trainer = await signUp(db, 'rm-trainer@gym.test', { role: 'trainer' });
    const client = await signUp(db, 'rm-client@gym.test', {});
    const { invite_code: code } = await one('select invite_code from public.profiles where id = $1', [trainer]);
    await rpc(client, 'select public.join_trainer($1)', [code]);

    assert.equal(await rpc(trainer, 'select public.remove_client($1)', [client]), true);
    assert.deepEqual((await query(client, 'select id from public.profiles')).map((r) => r.id), [client]);
    assert.deepEqual((await query(trainer, 'select id from public.profiles')).map((r) => r.id), [trainer]);
  });

  it('a client can leave their trainer', async () => {
    const client = await signUp(db, 'leaver@gym.test', {});
    await rpc(client, 'select public.join_trainer($1)', [codeB]);
    await query(client, 'select public.leave_trainer()');
    assert.equal((await one('select trainer_id from public.profiles where id = $1', [client])).trainer_id, null);
  });

  it('regenerating an invite code invalidates the old one, and only trainers can do it', async () => {
    const trainer = await signUp(db, 'regen@gym.test', { role: 'trainer' });
    const { invite_code: oldCode } = await one('select invite_code from public.profiles where id = $1', [trainer]);
    const newCode = await rpc(trainer, 'select public.regenerate_invite_code()');
    assert.match(newCode, /^[0-9A-F]{10}$/);
    assert.notEqual(newCode, oldCode);
    assert.equal((await rpc(c4, 'select public.join_trainer($1)', [oldCode])).error, 'INVALID_CODE');
    await denied(c4, 'select public.regenerate_invite_code()', [], /Only trainers have invite codes/);
  });
});

describe('account deletion', () => {
  it('is refused while a paid subscription is running', async () => {
    const trainer = await signUp(db, 'paying@gym.test', { role: 'trainer' });
    await admin(db, "insert into public.subscriptions (user_id, status) values ($1, 'active')", [trainer]);
    await denied(trainer, 'select public.delete_my_account()', [], /ACTIVE_SUBSCRIPTION/);
    assert.ok(await one('select 1 as present from auth.users where id = $1', [trainer]));
  });

  it("removes the user's data and only theirs", async () => {
    const trainer = await signUp(db, 'bye-trainer@gym.test', { role: 'trainer' });
    const client = await signUp(db, 'bye-client@gym.test', {});
    const { invite_code: code } = await one('select invite_code from public.profiles where id = $1', [trainer]);
    await rpc(client, 'select public.join_trainer($1)', [code]);
    await query(trainer, "insert into public.workouts (trainer_id, client_id, title) values ($1, $2, 'w')", [trainer, client]);
    const before = (await one('select count(*)::int as n from auth.users')).n;

    await query(trainer, 'select public.delete_my_account()');

    assert.equal((await one('select count(*)::int as n from auth.users')).n, before - 1);
    assert.equal(await one('select 1 as present from public.profiles where id = $1', [trainer]), undefined);
    assert.equal((await one('select count(*)::int as n from public.workouts where client_id = $1', [client])).n, 0);
    const orphan = await one('select trainer_id from public.profiles where id = $1', [client]);
    assert.equal(orphan.trainer_id, null);
  });
});

describe('migration', () => {
  it('can be applied twice without error or data loss', async () => {
    const before = await one('select count(*)::int as n from public.profiles');
    await reapplyMigrations(db);
    const after = await one('select count(*)::int as n from public.profiles');
    assert.equal(after.n, before.n);
    assert.deepEqual((await query(trainerA, "select id from public.profiles where role = 'client' order by email")).map((r) => r.id), [c1, c2]);
  });

  it('backfills profiles and invite codes for users created before the trigger existed', async () => {
    await admin(db, 'alter table auth.users disable trigger on_auth_user_created');
    const legacy = (await one("insert into auth.users (email, raw_user_meta_data) values ('legacy@gym.test', '{\"role\":\"trainer\"}') returning id")).id;
    await admin(db, 'alter table auth.users enable trigger on_auth_user_created');
    assert.equal(await one('select 1 as present from public.profiles where id = $1', [legacy]), undefined);

    await reapplyMigrations(db);
    const profile = await one('select role, invite_code from public.profiles where id = $1', [legacy]);
    assert.equal(profile.role, 'trainer');
    assert.match(profile.invite_code, /^[0-9A-F]{10}$/);
  });
});
