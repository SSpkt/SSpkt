// End-to-end tests: builds the web app, serves it, and drives it in a real browser against
// the local Supabase stand-in (which runs the real migrations and row-level security).
//
//   npm run test:e2e                 build, then test
//   npm run test:e2e -- --skip-build reuse the last build
//
// First time on a new machine: npx playwright install chromium
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { startEmulator } from './supabase-emulator.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = join(root, 'dist-e2e');
const shotsDir = join(root, 'test-results');
const APP_PORT = 8099;
const API_PORT = 54329;
const APP_URL = `http://localhost:${APP_PORT}`;
const PASSWORD = 'correct-horse-42';
const NEW_PASSWORD = 'battery-staple-77';

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
};

function build() {
  console.log('Building web app for tests...');
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['expo', 'export', '--platform', 'web', '--output-dir', distDir], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      EXPO_OFFLINE: '1',
      EXPO_PUBLIC_SUPABASE_URL: `http://localhost:${API_PORT}`,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
      EXPO_PUBLIC_BILLING_ENABLED: 'true',
      EXPO_PUBLIC_PRO_PRICE_LABEL: '$19/month',
    },
  });
}

function serveApp() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, APP_URL).pathname));
    let file = join(distDir, path);
    // Single-page app: any path that is not a real file gets index.html.
    if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(APP_PORT, '127.0.0.1', () => resolve(server)));
}

if (!process.argv.includes('--skip-build') || !existsSync(distDir)) build();
mkdirSync(shotsDir, { recursive: true });

const emulator = await startEmulator({ port: API_PORT });
const appServer = await serveApp();
const browser = await chromium.launch();
const { db } = emulator;

const problems = [];
let expectingFailures = false;

async function newUser(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error' || expectingFailures) return;
    // The browser logs every 4xx/5xx response; those are asserted on through the UI instead.
    if (/Failed to load resource/.test(message.text())) return;
    problems.push(`console.error: ${message.text()}`);
  });
  return page;
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const shot = (page, name) => page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true });
// Screens lower in the navigation stack stay mounted but hidden, so always target what is visible.
const tid = (page, testId) => page.getByTestId(testId).filter({ visible: true }).first();
const visible = (page, testId, timeout = 15000) => tid(page, testId).waitFor({ state: 'visible', timeout });
const text = (page, value, timeout = 15000) =>
  page.getByText(value).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });

async function signUp(page, { name, email, role }) {
  await page.goto(APP_URL);
  await visible(page, 'sign-in-screen');
  await tid(page, 'go-to-sign-up').click();
  await visible(page, 'sign-up-screen');
  await tid(page, `segment-${role}`).click();
  await tid(page, 'name-input').fill(name);
  await tid(page, 'email-input').fill(email);
  await tid(page, 'password-input').fill(PASSWORD);
  await tid(page, 'sign-up-button').click();
  await visible(page, role === 'trainer' ? 'trainer-dashboard' : 'client-dashboard');
}

async function signIn(page, email, password = PASSWORD) {
  await visible(page, 'sign-in-screen');
  await tid(page, 'email-input').fill(email);
  await tid(page, 'password-input').fill(password);
  await tid(page, 'sign-in-button').click();
}

/** Creates a client directly in the database and links them, for arranging state quickly. */
async function seedLinkedClient(email, name, code) {
  await db.exec('set role supabase_auth_admin');
  const { id } = await one('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [
    email, JSON.stringify({ full_name: name, role: 'client' }),
  ]).finally(() => db.exec('reset role'));
  await db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id })]);
    const { rows } = await tx.query('select public.join_trainer($1) as result', [code]);
    assert.equal(rows[0].result.ok, true);
  });
  return id;
}

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

let trainer, client, inviteCode, trainerId, clientId;

step('signed-out visitors land on the sign-in screen', async () => {
  trainer = await newUser();
  await trainer.goto(APP_URL);
  await visible(trainer, 'sign-in-screen');
  await shot(trainer, '01-sign-in');
  await trainer.goto(`${APP_URL}/account`);
  await visible(trainer, 'sign-in-screen');
});

step('forms validate before anything is sent', async () => {
  await tid(trainer, 'sign-in-button').click();
  await text(trainer, 'Enter your email address.');
  await text(trainer, 'Enter your password.');
  await tid(trainer, 'go-to-sign-up').click();
  await visible(trainer, 'sign-up-screen');
  await tid(trainer, 'email-input').fill('not-an-email');
  await tid(trainer, 'password-input').fill('short');
  await tid(trainer, 'sign-up-button').click();
  await text(trainer, 'Enter your name.');
  await text(trainer, 'Enter a valid email address.');
  await text(trainer, 'Use at least 10 characters.');
  assert.equal((await one('select count(*)::int as n from auth.users')).n, 0);
  await shot(trainer, '02-sign-up-validation');
});

step('a trainer signs up and sees an empty dashboard with an invite code', async () => {
  await signUp(trainer, { name: 'Tara Trainer', email: 'tara@example.com', role: 'trainer' });
  await visible(trainer, 'clients-empty');
  inviteCode = (await tid(trainer, 'invite-code').innerText()).trim();
  assert.match(inviteCode, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
  const row = await one("select id, role, invite_code from public.profiles where email = 'tara@example.com'");
  trainerId = row.id;
  assert.equal(row.role, 'trainer');
  assert.equal(row.invite_code, inviteCode.replace('-', ''));
  await text(trainer, '0 of 3 client spots used');
  await shot(trainer, '03-trainer-empty');
});

step('copying the invite code puts it on the clipboard', async () => {
  await tid(trainer, 'copy-invite-code').click();
  await text(trainer, 'Copied');
  assert.equal(await trainer.evaluate(() => navigator.clipboard.readText()), inviteCode);
});

step('a client signs up and sees no workouts and a prompt to link a trainer', async () => {
  client = await newUser();
  await signUp(client, { name: 'Cleo Client', email: 'cleo@example.com', role: 'client' });
  await visible(client, 'workouts-empty');
  await text(client, 'No workouts assigned');
  await visible(client, 'invite-code-input');
  clientId = (await one("select id from public.profiles where email = 'cleo@example.com'")).id;
  await shot(client, '04-client-unlinked');
});

step('a wrong invite code is rejected with a clear message', async () => {
  await tid(client, 'invite-code-input').fill('123');
  await tid(client, 'join-button').click();
  await text(client, 'Invite codes are 10 characters long.');
  await tid(client, 'invite-code-input').fill('ZZZZZ-ZZZZZ');
  await tid(client, 'join-button').click();
  await visible(client, 'join-error');
  await text(client, "That code doesn't match any trainer.");
});

step('the right invite code links the client to the trainer', async () => {
  await tid(client, 'invite-code-input').fill(inviteCode.toLowerCase());
  await tid(client, 'join-button').click();
  await visible(client, 'coach-name');
  assert.match(await tid(client, 'coach-name').innerText(), /Tara Trainer/);
  assert.equal((await one('select trainer_id from public.profiles where id = $1', [clientId])).trainer_id, trainerId);
});

step('the trainer now sees the client', async () => {
  await trainer.reload();
  await visible(trainer, `client-row-${clientId}`);
  await text(trainer, 'Cleo Client');
  await text(trainer, '1 of 3 client spots used');
  await text(trainer, 'No workouts assigned');
});

step('the assign-workout modal validates and then saves the workout', async () => {
  await tid(trainer, `assign-button-${clientId}`).click();
  await visible(trainer, 'assign-workout-sheet');
  await text(trainer, 'For Cleo Client');
  await tid(trainer, 'assign-submit-button').click();
  await text(trainer, 'Give the workout a title.');
  await tid(trainer, 'workout-title-input').fill('Lower body strength');
  await tid(trainer, 'workout-notes-input').fill('Back squat 5 x 5\nRomanian deadlift 3 x 8');
  await trainer.waitForTimeout(600); // let the open animation finish
  await shot(trainer, '05-assign-workout-modal');
  await tid(trainer, 'assign-submit-button').click();
  await visible(trainer, 'dashboard-notice');
  await text(trainer, '0 of 1 workouts done');

  const workout = await one('select * from public.workouts where client_id = $1', [clientId]);
  assert.equal(workout.trainer_id, trainerId);
  assert.equal(workout.title, 'Lower body strength');
  assert.equal(workout.notes, 'Back squat 5 x 5\nRomanian deadlift 3 x 8');
  assert.equal(workout.is_completed, false);
  await shot(trainer, '06-trainer-with-client');
});

step('the client sees the workout and ticks it off', async () => {
  await client.reload();
  await text(client, 'Lower body strength');
  await text(client, 'Back squat 5 x 5');
  assert.match(await tid(client, 'progress-count').innerText(), /0\s*\/ 1/);
  await shot(client, '07-client-todo');

  const { id } = await one('select id from public.workouts where client_id = $1', [clientId]);
  await tid(client, `workout-checkbox-${id}`).click();
  await text(client, 'All done. Nice work.');
  await client.waitForFunction(() => document.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true');
  await client.waitForTimeout(300);
  const saved = await one('select is_completed, completed_at from public.workouts where id = $1', [id]);
  assert.equal(saved.is_completed, true);
  assert.ok(saved.completed_at instanceof Date);
  await shot(client, '08-client-done');

  // Unticking is persisted too.
  await tid(client, `workout-checkbox-${id}`).click();
  await text(client, 'workouts completed');
  await client.waitForTimeout(300);
  assert.equal((await one('select is_completed from public.workouts where id = $1', [id])).is_completed, false);
  await tid(client, `workout-checkbox-${id}`).click();
  await text(client, 'All done. Nice work.');
  await client.waitForTimeout(300);
});

step('the session survives a page reload', async () => {
  await client.reload();
  await visible(client, 'client-dashboard');
  await text(client, 'All done. Nice work.');
});

step('the trainer sees the completion on the client detail screen', async () => {
  await trainer.reload();
  await text(trainer, '1 of 1 workouts done');
  await tid(trainer, `client-row-${clientId}`).click();
  await visible(trainer, 'client-detail');
  await text(trainer, 'Completed');
  await text(trainer, 'cleo@example.com');
  await shot(trainer, '09-client-detail');
});

step('a failed request shows an error with a working retry', async () => {
  expectingFailures = true;
  emulator.state.failRest = true;
  await tid(trainer, 'back-button').click();
  await visible(trainer, 'clients-error');
  await text(trainer, 'Could not load your clients.');
  await shot(trainer, '10-error-banner');
  emulator.state.failRest = false;
  await tid(trainer, 'clients-error-action').click();
  await trainer.getByTestId('clients-error').waitFor({ state: 'hidden' });
  await text(trainer, '1 of 1 workouts done');
  expectingFailures = false;
});

step('an outage during startup shows a recoverable profile error, not a blank screen', async () => {
  expectingFailures = true;
  emulator.state.failRest = true;
  await trainer.reload();
  await visible(trainer, 'profile-error');
  emulator.state.failRest = false;
  await tid(trainer, 'profile-retry').click();
  await visible(trainer, 'trainer-dashboard');
  expectingFailures = false;
});

step("a client cannot open trainer screens or another user's data by URL", async () => {
  await client.goto(`${APP_URL}/client/${trainerId}`);
  await visible(client, 'client-dashboard');
  assert.equal(await client.getByTestId('client-detail').count(), 0);
  assert.equal(await client.getByTestId('trainer-dashboard').count(), 0);
});

step('the free plan stops at three clients and tells the fourth why', async () => {
  const code = inviteCode.replace('-', '');
  await seedLinkedClient('second@example.com', 'Second Client', code);
  await seedLinkedClient('third@example.com', 'Third Client', code);
  const fourth = await newUser();
  await signUp(fourth, { name: 'Fourth Client', email: 'fourth@example.com', role: 'client' });
  await tid(fourth, 'invite-code-input').fill(inviteCode);
  await tid(fourth, 'join-button').click();
  await text(fourth, "Your trainer's plan is full.");
  await shot(fourth, '11-plan-full');
  await fourth.context().close();

  await trainer.reload();
  await text(trainer, '3 of 3 client spots used');
});

step('the account screen shows the plan and an upgrade button on the web', async () => {
  await tid(trainer, 'plan-row').click();
  await visible(trainer, 'account-screen');
  assert.equal((await tid(trainer, 'plan-name').innerText()).trim(), 'Free');
  await visible(trainer, 'upgrade-button');
  await text(trainer, 'Upgrade to Pro · $19/month');
  await shot(trainer, '12-account-trainer');
});

step('returning from checkout waits for the payment to register, then shows Pro', async () => {
  await trainer.goto(`${APP_URL}/account?billing=success`);
  await visible(trainer, 'billing-pending');
  assert.equal((await tid(trainer, 'plan-name').innerText()).trim(), 'Free');

  // The webhook lands a moment later; the screen picks it up without a reload.
  await db.query("insert into public.subscriptions (user_id, status, current_period_end) values ($1, 'active', now() + interval '30 days')", [trainerId]);
  await visible(trainer, 'billing-success');
  assert.equal((await tid(trainer, 'plan-name').innerText()).trim(), 'Pro');
  await visible(trainer, 'manage-billing');
  assert.equal(await trainer.getByTestId('upgrade-button').count(), 0);
  await text(trainer, 'Unlimited clients.');
  await shot(trainer, '12b-account-pro');

  await db.query('delete from public.subscriptions where user_id = $1', [trainerId]);
  await trainer.goto(`${APP_URL}/account`);
  await visible(trainer, 'account-screen');
});

step('renaming yourself is saved', async () => {
  await tid(trainer, 'account-name-input').fill('Tara T. Trainer');
  await tid(trainer, 'save-name-button').click();
  await visible(trainer, 'account-notice');
  assert.equal((await one('select full_name from public.profiles where id = $1', [trainerId])).full_name, 'Tara T. Trainer');
});

step('signing out returns to sign-in and the session is really gone', async () => {
  await tid(trainer, 'sign-out-button').click();
  await visible(trainer, 'sign-in-screen');
  await trainer.reload();
  await visible(trainer, 'sign-in-screen');
  const stored = await trainer.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('auth-token')));
  assert.deepEqual(stored, []);
});

step('a wrong password is refused without revealing whether the account exists', async () => {
  expectingFailures = true;
  await signIn(trainer, 'tara@example.com', 'wrong-password-1');
  await text(trainer, 'Incorrect email or password.');
  await signIn(trainer, 'nobody@example.com', 'wrong-password-1');
  await text(trainer, 'Incorrect email or password.');
  expectingFailures = false;
});

step('signing back in routes a trainer to the trainer dashboard', async () => {
  await signIn(trainer, 'tara@example.com');
  await visible(trainer, 'trainer-dashboard');
  await text(trainer, 'Cleo Client');
});

step('password reset works, but only on the device that requested it', async () => {
  const visitor = await newUser();
  await visitor.goto(APP_URL);
  await visible(visitor, 'sign-in-screen');
  await tid(visitor, 'go-to-forgot-password').click();
  await visible(visitor, 'forgot-password-screen');

  // An unknown address gets the same answer and produces no reset code.
  await tid(visitor, 'email-input').fill('nobody@example.com');
  await tid(visitor, 'send-reset-button').click();
  await text(visitor, 'If an account exists for that address');
  assert.equal(emulator.state.lastRecoveryCode, null);

  await visitor.goto(`${APP_URL}/forgot-password`);
  await visible(visitor, 'forgot-password-screen');
  await tid(visitor, 'email-input').fill('tara@example.com');
  await tid(visitor, 'send-reset-button').click();
  await text(visitor, 'If an account exists for that address');
  const code = emulator.state.lastRecoveryCode;
  assert.ok(code, 'a reset code should have been issued');

  // Someone who intercepts the emailed link cannot use it from their own browser.
  expectingFailures = true;
  const thief = await newUser();
  await thief.goto(`${APP_URL}/reset-password?code=${code}`);
  await visible(thief, 'sign-in-screen');
  assert.equal(await thief.getByTestId('reset-password-screen').count(), 0);
  await thief.context().close();
  expectingFailures = false;

  await visitor.goto(`${APP_URL}/reset-password?code=${code}`);
  await visible(visitor, 'reset-password-screen');
  await shot(visitor, '16-reset-password');
  await tid(visitor, 'password-input').fill('weak');
  await tid(visitor, 'save-password-button').click();
  await text(visitor, 'Use at least 10 characters.');
  await tid(visitor, 'password-input').fill(NEW_PASSWORD);
  await tid(visitor, 'save-password-button').click();
  await visible(visitor, 'trainer-dashboard');

  // The old password no longer works; the new one does.
  await tid(visitor, 'account-button').click();
  await tid(visitor, 'sign-out-button').click();
  expectingFailures = true;
  await signIn(visitor, 'tara@example.com', PASSWORD);
  await text(visitor, 'Incorrect email or password.');
  expectingFailures = false;
  await signIn(visitor, 'tara@example.com', NEW_PASSWORD);
  await visible(visitor, 'trainer-dashboard');
  await visitor.context().close();
});

step('a client can delete their account, which removes their data', async () => {
  await client.goto(`${APP_URL}/account`);
  await visible(client, 'account-screen');
  // Opening the page directly must still pre-fill the form from the profile.
  assert.equal(await tid(client, 'account-name-input').inputValue(), 'Cleo Client');
  await shot(client, '13-account-client');
  await tid(client, 'delete-account-button').click();
  await visible(client, 'confirm-dialog');
  assert.equal(await tid(client, 'confirm-dialog-confirm').isDisabled(), true);
  await tid(client, 'delete-confirm-input').fill('delete');
  await client.waitForTimeout(600); // let the open animation finish
  await shot(client, '14-delete-dialog');
  await tid(client, 'confirm-dialog-confirm').click();
  await visible(client, 'sign-in-screen');
  assert.equal(await one('select 1 as present from auth.users where id = $1', [clientId]), undefined);
  assert.equal((await one('select count(*)::int as n from public.workouts where client_id = $1', [clientId])).n, 0);
});

step('the layout holds up on a desktop-sized window', async () => {
  const desktop = await newUser({ width: 1440, height: 900 });
  await desktop.goto(APP_URL);
  await signIn(desktop, 'tara@example.com', NEW_PASSWORD);
  await visible(desktop, 'trainer-dashboard');
  await text(desktop, 'Second Client');
  await shot(desktop, '15-desktop-trainer');
  const overflow = await desktop.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'page should not scroll horizontally');
  await desktop.context().close();
});

let failed = 0;
for (const { name, fn } of steps) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n').join('\n        ')}`);
    for (const [label, page] of [['trainer', trainer], ['client', client]]) {
      if (page && !page.isClosed()) await shot(page, `failure-${label}`).catch(() => undefined);
    }
    break; // later steps depend on earlier ones
  }
}

if (problems.length) {
  failed += 1;
  console.log(`  FAIL  no unexpected browser errors\n        ${problems.join('\n        ')}`);
} else if (!failed) {
  console.log('  ok    no unexpected browser errors');
}

await browser.close();
await emulator.close();
await new Promise((resolve) => appServer.close(resolve));
console.log(failed ? `\n${failed} problem(s). Screenshots are in test-results/.` : `\nAll ${steps.length} end-to-end steps passed.`);
process.exit(failed ? 1 : 0);
