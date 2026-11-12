// A small local stand-in for Supabase (Auth + REST) used only by the end-to-end tests.
// Data lives in an in-process Postgres with the real migrations applied, and every REST call
// runs as the `authenticated` or `anon` role with the caller's JWT claims, so the browser
// tests exercise the real row-level security. It implements just the subset of the Supabase
// HTTP API that the app uses; it is not a general-purpose emulator.
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { createDatabase } from '../db/harness.mjs';

const JWT_SECRET = randomBytes(32);
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const TABLES = new Set(['profiles', 'workouts', 'subscriptions']);

const b64url = (input) => Buffer.from(input).toString('base64url');

function signJwt(payload) {
  const body = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
}

function verifyJwt(token) {
  const [header, payload, signature] = (token ?? '').split('.');
  if (!header || !payload || !signature) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}

class HttpError extends Error {
  constructor(status, body) {
    super(body.message ?? body.msg ?? 'error');
    this.status = status;
    this.body = body;
  }
}

const authError = (status, code, msg) => new HttpError(status, { code, error_code: code, msg });

export async function startEmulator({ port = 54321 } = {}) {
  const db = await createDatabase();
  const passwords = new Map(); // user id -> { salt, hash }
  const refreshTokens = new Map(); // refresh token -> user id
  /** Tests can flip this to make every REST call fail, simulating an outage. */
  const state = { failRest: false };

  const hashPassword = (password, salt) => scryptSync(password, salt, 32);

  async function getUser(id) {
    const { rows } = await db.query('select id, email, raw_user_meta_data from auth.users where id = $1', [id]);
    if (!rows[0]) return null;
    const now = new Date().toISOString();
    return {
      id: rows[0].id,
      aud: 'authenticated',
      role: 'authenticated',
      email: rows[0].email,
      email_confirmed_at: now,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: rows[0].raw_user_meta_data,
      identities: [],
      created_at: now,
      updated_at: now,
    };
  }

  async function issueSession(userId) {
    const user = await getUser(userId);
    if (!user) throw authError(400, 'invalid_credentials', 'Invalid login credentials');
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const refreshToken = randomBytes(16).toString('hex');
    refreshTokens.set(refreshToken, userId);
    return {
      access_token: signJwt({
        sub: userId, role: 'authenticated', aud: 'authenticated', email: user.email,
        iat: Math.floor(Date.now() / 1000), exp: expiresAt, session_id: randomUUID(),
      }),
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      refresh_token: refreshToken,
      user,
    };
  }

  async function handleAuth(method, path, query, body, claims) {
    if (method === 'POST' && path === '/signup') {
      const email = String(body.email ?? '').toLowerCase();
      if (!email || String(body.password ?? '').length < 6) throw authError(422, 'weak_password', 'Password too short');
      const existing = await db.query('select 1 from auth.users where email = $1', [email]);
      if (existing.rows.length) throw authError(422, 'user_already_exists', 'User already registered');
      await db.exec('set role supabase_auth_admin');
      let id;
      try {
        ({ rows: [{ id }] } = await db.query(
          'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
          [email, JSON.stringify(body.data ?? {})],
        ));
      } finally {
        await db.exec('reset role');
      }
      const salt = randomBytes(16);
      passwords.set(id, { salt, hash: hashPassword(body.password, salt) });
      return [200, await issueSession(id)];
    }

    if (method === 'POST' && path === '/token' && query.get('grant_type') === 'password') {
      const { rows } = await db.query('select id from auth.users where email = $1', [String(body.email ?? '').toLowerCase()]);
      const stored = rows[0] && passwords.get(rows[0].id);
      if (!stored || !timingSafeEqual(stored.hash, hashPassword(String(body.password ?? ''), stored.salt))) {
        throw authError(400, 'invalid_credentials', 'Invalid login credentials');
      }
      return [200, await issueSession(rows[0].id)];
    }

    if (method === 'POST' && path === '/token' && query.get('grant_type') === 'refresh_token') {
      const userId = refreshTokens.get(body.refresh_token);
      if (!userId) throw authError(400, 'refresh_token_not_found', 'Invalid Refresh Token');
      refreshTokens.delete(body.refresh_token);
      return [200, await issueSession(userId)];
    }

    if (method === 'GET' && path === '/user') {
      const user = claims && (await getUser(claims.sub));
      if (!user) throw authError(403, 'user_not_found', 'User from sub claim in JWT does not exist');
      return [200, user];
    }

    if (method === 'POST' && path === '/logout') return [204, null];

    throw authError(404, 'not_found', `Emulator does not implement ${method} /auth/v1${path}`);
  }

  function parseFilters(query, params) {
    const clauses = [];
    for (const [key, value] of query) {
      if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
      if (!IDENTIFIER.test(key) || !value.startsWith('eq.')) {
        throw new HttpError(400, { code: 'PGRST100', message: `Emulator only supports eq filters (got ${key}=${value})` });
      }
      params.push(value.slice(3));
      clauses.push(`${key}::text = $${params.length}`);
    }
    return clauses.length ? ` where ${clauses.join(' and ')}` : '';
  }

  function parseColumns(select) {
    if (!select || select === '*') return '*';
    const columns = select.split(',').map((column) => column.trim());
    if (!columns.every((column) => IDENTIFIER.test(column))) {
      throw new HttpError(400, { code: 'PGRST100', message: 'Emulator only supports plain column lists' });
    }
    return columns.join(', ');
  }

  function parseOrder(order) {
    if (!order) return '';
    const parts = order.split(',').map((item) => {
      const [column, direction = 'asc'] = item.split('.');
      if (!IDENTIFIER.test(column) || !['asc', 'desc'].includes(direction)) {
        throw new HttpError(400, { code: 'PGRST100', message: 'Bad order' });
      }
      return `${column} ${direction}`;
    });
    return ` order by ${parts.join(', ')}`;
  }

  function buildStatement(method, target, query, body, wantsRows) {
    const params = [];
    if (target.startsWith('rpc/')) {
      const fn = target.slice(4);
      if (method !== 'POST' || !IDENTIFIER.test(fn)) throw new HttpError(404, { code: 'PGRST202', message: 'Not found' });
      const args = Object.entries(body ?? {}).map(([name, value]) => {
        if (!IDENTIFIER.test(name)) throw new HttpError(400, { code: 'PGRST100', message: 'Bad argument' });
        params.push(value);
        return `${name} => $${params.length}`;
      });
      return { sql: `select public.${fn}(${args.join(', ')}) as result`, params, rpc: true };
    }

    if (!TABLES.has(target)) throw new HttpError(404, { code: 'PGRST205', message: `Could not find the table 'public.${target}'` });
    const columns = parseColumns(query.get('select'));
    const returning = wantsRows ? ` returning ${columns}` : '';

    if (method === 'GET') {
      const where = parseFilters(query, params);
      return { sql: `select ${columns} from public.${target}${where}${parseOrder(query.get('order'))}`, params };
    }
    if (method === 'POST') {
      const keys = Object.keys(body ?? {});
      if (!keys.every((key) => IDENTIFIER.test(key))) throw new HttpError(400, { code: 'PGRST100', message: 'Bad column' });
      keys.forEach((key) => params.push(body[key]));
      const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
      return { sql: `insert into public.${target} (${keys.join(', ')}) values (${placeholders})${returning}`, params };
    }
    if (method === 'PATCH') {
      const keys = Object.keys(body ?? {});
      if (!keys.length || !keys.every((key) => IDENTIFIER.test(key))) throw new HttpError(400, { code: 'PGRST100', message: 'Bad column' });
      keys.forEach((key) => params.push(body[key]));
      const assignments = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
      return { sql: `update public.${target} set ${assignments}${parseFilters(query, params)}${returning}`, params };
    }
    if (method === 'DELETE') {
      return { sql: `delete from public.${target}${parseFilters(query, params)}${returning}`, params };
    }
    throw new HttpError(405, { code: 'PGRST105', message: 'Method not allowed' });
  }

  async function handleRest(method, target, query, body, claims, headers) {
    if (state.failRest) throw new HttpError(503, { code: 'PGRST000', message: 'Simulated outage' });
    const wantsObject = (headers.accept ?? '').includes('vnd.pgrst.object');
    const wantsRows = method === 'GET' || (headers.prefer ?? '').includes('return=representation');
    const statement = buildStatement(method, target, query, body, wantsRows);
    const role = claims ? 'authenticated' : 'anon';

    let rows;
    try {
      rows = await db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role })]);
        return (await tx.query(statement.sql, statement.params)).rows;
      });
    } catch (error) {
      if (!error.code) throw error;
      const status = error.code === '42501' ? (claims ? 403 : 401) : error.code.startsWith('23') ? 409 : 400;
      throw new HttpError(status, { code: error.code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null });
    }

    if (statement.rpc) {
      const result = rows[0]?.result;
      return result === null || result === undefined || result === '' ? [204, null] : [200, result];
    }
    if (!wantsRows) return [method === 'POST' ? 201 : 204, null];
    if (wantsObject) {
      if (rows.length !== 1) {
        throw new HttpError(406, {
          code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${rows.length} rows`, hint: null,
        });
      }
      return [method === 'POST' ? 201 : 200, rows[0]];
    }
    return [method === 'POST' ? 201 : 200, rows];
  }

  const server = createServer(async (req, res) => {
    const cors = {
      'access-control-allow-origin': req.headers.origin ?? '*',
      'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-max-age': '600',
      'x-supabase-api-version': '2024-01-01',
    };
    const send = (status, payload) => {
      res.writeHead(status, { ...cors, 'content-type': 'application/json' });
      res.end(payload === null ? '' : JSON.stringify(payload));
    };

    if (req.method === 'OPTIONS') return send(204, null);

    try {
      const url = new URL(req.url, 'http://localhost');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : null;
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const claims = verifyJwt(bearer);

      let result;
      if (url.pathname.startsWith('/auth/v1/')) {
        result = await handleAuth(req.method, url.pathname.slice('/auth/v1'.length), url.searchParams, body ?? {}, claims);
      } else if (url.pathname.startsWith('/rest/v1/')) {
        result = await handleRest(req.method, url.pathname.slice('/rest/v1/'.length), url.searchParams, body, claims, req.headers);
      } else {
        throw new HttpError(404, { code: 'not_found', message: `Emulator does not implement ${url.pathname}` });
      }
      send(result[0], result[1]);
    } catch (error) {
      if (error instanceof HttpError) send(error.status, error.body);
      else {
        console.error('[emulator]', error);
        send(500, { code: 'emulator_error', message: String(error?.message ?? error) });
      }
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    db,
    state,
    url: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
