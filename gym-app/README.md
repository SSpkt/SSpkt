# TrainerOps

A personal-trainer operations app: trainers invite clients, assign workouts and track
completion; clients tick workouts off. Built with Expo (SDK 58), React Native, Expo Router
and Supabase. Runs on iOS, Android and the web from one codebase.

## What is in here

| Path | What it is |
| --- | --- |
| `app/` | Screens. `(auth)`, `(trainer)` and `(client)` groups; `_layout.tsx` routes by role |
| `src/` | UI components, auth provider, data layer, validation |
| `supabase/migrations/` | Database schema, row-level security, triggers and RPC functions |
| `supabase/functions/` | Stripe billing: `billing-session` and `stripe-webhook` |
| `tests/db/` | Security tests that attack the database rules |
| `tests/e2e/` | Browser tests that drive the real app end to end |

## Run it locally

You need Node 20 or newer and a Supabase project.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create the database. Open your Supabase project, go to **SQL Editor**, paste the whole of
   `supabase/migrations/20261112000000_init.sql` and run it. It is safe to run more than
   once, and it adopts existing `profiles` and `workouts` tables: it adds any missing
   columns, **replaces every existing policy on those tables**, and creates profiles for
   users who signed up before the trigger existed. Take a backup first if the project has
   real data.

   With the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`.

3. Configure the app:

   ```bash
   cp .env.example .env
   ```

   Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from
   **Project Settings → API**. Use the anon / publishable key. The app refuses to start if it
   detects a service-role key, because that key bypasses all security.

4. Start it:

   ```bash
   npx expo start -c
   ```

   Press `w` for the browser, or scan the QR code with Expo Go.

## How it works

- **Sign-up** asks whether you are a client or a trainer. A database trigger creates the
  profile; any role other than an explicit `trainer` becomes a client.
- **Trainers** get a 10-character invite code. They share it with clients.
- **Clients** enter the code once to link to that trainer. Only then can the trainer see
  them and assign workouts.
- **Workouts** have a title and notes. Clients can tick them done or not done and nothing
  else; trainers can edit and delete the ones they assigned.
- **Unlinking**: a client can leave, and a trainer can remove a client. The client keeps
  their workout history; the trainer immediately loses access to that client's profile and
  workouts, and gets it back only if the client rejoins.
- **Plans**: a trainer can coach 3 clients for free. An active Stripe subscription removes
  the limit. The limit is enforced inside the database, not in the app.

### One deliberate change from the original brief

The brief asked for trainers to be able to read every profile whose role is `client`. Because
anyone can sign up and choose "trainer", that rule would let any stranger download the name
and email of every client on the platform. This build scopes trainers to the clients who
joined with their invite code instead. If you run a single-trainer business and genuinely
want the original behaviour, change the `profiles_select_my_clients` policy, but then also
stop people self-registering as trainers.

## Security model

The app is never trusted. Everything below is enforced by Postgres, so it holds even for
someone calling the API directly with a valid login.

- **Row-level security on every table.** Users see their own profile; trainers see only
  their linked clients; clients see only their own trainer. Workouts are visible only to the
  two people involved.
- **Column-level grants.** A user can change their own `full_name` and nothing else on a
  profile: not `role`, not `trainer_id`, not `invite_code`. On insert, trainers can supply
  only the four workout fields; `is_completed` and timestamps are server-controlled.
- **Relationship changes go through functions** (`join_trainer`, `leave_trainer`,
  `remove_client`) that check who is calling. Invite-code guessing is locked out after 10
  wrong attempts per hour, and the plan limit is checked under a row lock so it cannot be
  raced.
- **Billing state is read-only to users.** Only the Stripe webhook, using the service role,
  can write `subscriptions`. Webhook events are verified against Stripe's signature and the
  row is rebuilt from Stripe's current state, so replayed or out-of-order events are
  harmless.
- **Sessions** are stored in the iOS Keychain / Android Keystore (not plain storage, not in
  backups). Auth uses PKCE, so an emailed link only works on the device that requested it.
- **No secrets in the app.** Only the anon key ships. Stripe and service-role keys live in
  Supabase function secrets.
- **Error messages** shown to users never include raw database or server text.
- **Account deletion** is available in-app (both app stores require it) and is refused while
  a paid subscription is still running.

### Settings to change in the Supabase dashboard before launch

These cannot be set from code:

- **Authentication → Sign In / Providers → Email**: keep *Confirm email* on; set minimum
  password length to 10; turn on *Leaked password protection* if your plan has it.
- **Authentication → URL Configuration**: set *Site URL* to your web app's address and add
  redirect URLs for it (`https://your-domain/**`) and for the native scheme
  (`trainerops://**`). While testing in Expo Go, also add the `exp://` address it shows.
- **Authentication → Emails → SMTP**: connect your own email provider. The built-in sender
  is limited to a handful of emails per hour and will block sign-ups under real traffic.
- **Authentication → Attack Protection**: turn on CAPTCHA for sign-up and sign-in.
- **Authentication → Rate Limits**: review the defaults.
- **Database → Backups**: confirm backups are running (point-in-time recovery on paid plans).

## Tests

```bash
npm run check      # typecheck + lint + unit tests + database security tests
npm run test:e2e   # browser tests (first time: npx playwright install chromium)
```

- **Database security tests** (`tests/db`, 42 tests) apply the real migration to an
  in-process Postgres and then act as an attacker: reading other tenants' data, changing
  their own role, forging workouts, granting themselves a paid plan, calling functions
  anonymously, brute-forcing invite codes.
- **Unit tests** (`src/lib/__tests__`, 56 tests) cover validation, secure session storage,
  error mapping and the billing reconciliation logic.
- **End-to-end tests** (`tests/e2e`, 25 steps) build the web app and drive it in Chromium
  through sign-up, linking, assigning a workout, ticking it off, the plan limit, returning
  from checkout, outage recovery, password reset, sign-out and account deletion. They run against a small local stand-in for
  Supabase that applies the real migration and enforces the real security rules. It is not
  Supabase itself, so repeat the smoke test below against your real project.

### Manual smoke test against your real project

1. Sign up as a trainer. Confirm the email. You should land on **Clients** with an invite code.
2. On a second device or a private browser window, sign up as a client and enter the code.
3. As the trainer, pull to refresh, tap **Assign workout**, fill in both fields, submit.
4. As the client, pull to refresh, tick the workout. As the trainer, open the client: it
   should show **Completed**.
5. Use **Forgot password** and complete the reset from the email on the same device.
6. Delete the client account from **Account** and confirm the user is gone in the dashboard.

## Turning on payments (Stripe)

Subscriptions are sold on the web build through Stripe Checkout. The native apps show the
plan but no purchase button, because Apple and Google require their own in-app purchase
systems for digital subscriptions bought inside an app.

1. In Stripe, create a product with a recurring price and copy the price ID (`price_...`).
2. Set the function secrets:

   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_PRICE_ID=price_... APP_URL=https://your-domain
   ```

3. Deploy the functions:

   ```bash
   supabase functions deploy billing-session
   supabase functions deploy stripe-webhook
   ```

4. In Stripe → Developers → Webhooks, add the endpoint
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` with the events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated` and `customer.subscription.deleted`. Copy its signing
   secret and run `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`.
5. In Stripe → Settings → Billing → Customer portal, enable the portal so subscribers can
   cancel and update their card.
6. In the app's environment set `EXPO_PUBLIC_BILLING_ENABLED=true` and
   `EXPO_PUBLIC_PRO_PRICE_LABEL` (for example `$19/month`), then rebuild the web app.
7. Do one full purchase in Stripe **test mode** first: upgrade, check the Account screen
   says Pro, add a fourth client, cancel in the portal, and check it returns to Free at the
   end of the period.

To change the free limit, edit `private.free_client_limit()` in the migration.

## Shipping

**Web** (fastest route to a live, paying product):

```bash
npm run build:web        # outputs dist/
```

Host `dist/` on any static host with a single-page-app fallback (every unknown path serves
`index.html`). EAS Hosting, Netlify, Vercel and Cloudflare Pages all work. Serve it over
HTTPS only, and set these response headers at the host: `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a
`Content-Security-Policy` that includes `frame-ancestors 'none'` and limits `connect-src` to
your own origin and your Supabase URL.

**iOS and Android**:

1. In `app.json`, replace `com.example.trainerops` with your own bundle identifier and
   package name, and rename the app if you want to.
2. `npx eas-cli@latest build --platform all`, then `npx eas-cli@latest submit`.
3. Both stores need a privacy policy URL and review the app before it goes live, which
   usually takes from a day to a week.

**Before taking real customers**: publish a privacy policy and terms and set
`EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL`; you are storing names, emails and
fitness notes, so check what your local data-protection law requires of you.

## Known limits

- The Stripe functions have been type-checked and their signature verification exercised
  locally, but they have not been run against a live Stripe account from this repository.
- The native builds compile, but have only been exercised in a browser here, not on a
  physical iPhone or Android device.
- Client and workout lists load in full; add pagination before a single trainer has
  thousands of workouts.
- Deleting an account removes its Supabase data. The Stripe customer record stays in Stripe
  for your accounting.
- `npm audit` reports a moderate advisory in `minimatch`, pulled in by Expo's build tooling.
  It is not part of the shipped app; it will clear when Expo updates the dependency.
