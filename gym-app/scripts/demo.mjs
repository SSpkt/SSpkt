// Live demo with no Supabase account needed: builds the web app, starts the local Supabase
// stand-in from tests/e2e with the real migration, seeds demo users, and serves both on one
// port so it works behind any preview URL.   npm run demo  ->  http://localhost:8090
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startEmulator } from '../tests/e2e/supabase-emulator.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist-demo');
const PORT = Number(process.env.PORT ?? 8090);
const API_PORT = 54331;
// Baked into the bundle at build time, swapped for the real origin of each request.
const PLACEHOLDER = 'https://demo-origin.placeholder';
const PASSWORD = 'demo-pass-2026';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf',
};

if (!process.argv.includes('--skip-build') || !existsSync(distDir)) {
  console.log('Building web app...');
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['expo', 'export', '--platform', 'web', '--output-dir', distDir], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, EXPO_OFFLINE: '1', EXPO_PUBLIC_SUPABASE_URL: PLACEHOLDER, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'demo-anon-key' },
  });
}

const emulator = await startEmulator({ port: API_PORT });
const api = (path, body, token) =>
  fetch(`http://localhost:${API_PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'return=representation', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  });
const signUp = (email, full_name, role) => api('/auth/v1/signup', { email, password: PASSWORD, data: { full_name, role } });

const coach = await signUp('coach@demo.app', 'Alex Morgan', 'trainer');
const { rows: [{ invite_code: code }] } = await emulator.db.query('select invite_code from public.profiles where id = $1', [coach.user.id]);
const clients = [];
for (const [email, name] of [['sam@demo.app', 'Sam Rivera'], ['jordan@demo.app', 'Jordan Lee']]) {
  const session = await signUp(email, name, 'client');
  await api('/rest/v1/rpc/join_trainer', { p_code: code }, session.access_token);
  clients.push(session);
}
const workouts = [
  [0, 'Lower body strength', 'Back squat 5 x 5\nRomanian deadlift 3 x 8\nWalking lunges 3 x 12 each leg', true],
  [0, 'Upper body push', 'Bench press 4 x 6\nOverhead press 3 x 8\nDips 3 x max', false],
  [0, 'Conditioning', '10 rounds: 200 m row, 10 kettlebell swings, 10 burpees', false],
  [1, 'Full body intro', 'Goblet squat 3 x 10\nPush-ups 3 x 10\nPlank 3 x 30 s', true],
  [1, 'Mobility day', '20 minutes: hips, thoracic spine, ankles', false],
];
for (const [who, title, notes, done] of workouts) {
  const [workout] = await api('/rest/v1/workouts', { trainer_id: coach.user.id, client_id: clients[who].user.id, title, notes }, coach.access_token);
  if (done) {
    await fetch(`http://localhost:${API_PORT}/rest/v1/workouts?id=eq.${workout.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${clients[who].access_token}` },
      body: JSON.stringify({ is_completed: true }),
    });
  }
}
await signUp('newclient@demo.app', 'Casey Kim', 'client');

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (/^\/(auth|rest|functions)\/v1\//.test(url.pathname)) {
    const upstream = request(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
    return;
  }

  let file = join(distDir, normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const headers = { 'content-type': type, 'cache-control': 'no-store' };
  if (type === 'application/javascript') {
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${PORT}`).split(',')[0].trim();
    res.writeHead(200, headers);
    res.end(readFileSync(file, 'utf8').replaceAll(PLACEHOLDER, `${proto}://${host}`));
    return;
  }
  res.writeHead(200, headers);
  res.end(readFileSync(file));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nTrainerOps demo running at http://localhost:${PORT}\n`);
  console.log(`  Trainer:            coach@demo.app      / ${PASSWORD}`);
  console.log(`  Client (3 workouts): sam@demo.app       / ${PASSWORD}`);
  console.log(`  Client (2 workouts): jordan@demo.app    / ${PASSWORD}`);
  console.log(`  Client (unlinked):   newclient@demo.app / ${PASSWORD}   invite code: ${code}`);
  console.log('\nData lives in memory and resets when this stops. Ctrl+C to stop.');
});
