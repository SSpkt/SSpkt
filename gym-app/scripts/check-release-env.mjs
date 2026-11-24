#!/usr/bin/env node
// Refuses to ship a release build that is missing the settings the app stores and data-protection
// law expect: a real Supabase project, a public (never secret) key, and the Terms and Privacy
// links shown on the sign-up screen. Without those links the app quietly hides the
// "By creating an account you agree to..." line, so it is easy to launch without it.
//
// Run by hand with `npm run check:release`. EAS runs it automatically before installing
// dependencies (`eas-build-pre-install`); there it only enforces the production profile.
// Uses Node built-ins only, because it runs before `npm install`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PROFILE !== 'production') {
  console.log(`check-release-env: skipped for EAS profile "${process.env.EAS_BUILD_PROFILE}".`);
  process.exit(0);
}

// Values already in the environment (EAS environment variables, CI) win over .env.
const env = { ...readDotEnv(join(root, '.env')), ...process.env };
const problems = [];

const requireHttpsUrl = (name, why) => {
  const value = (env[name] ?? '').trim();
  if (!value) return problems.push(`${name} is not set. ${why}`);
  let url;
  try {
    url = new URL(value);
  } catch {
    return problems.push(`${name} is not a valid URL: "${value}".`);
  }
  if (url.protocol !== 'https:') problems.push(`${name} must use https: "${value}".`);
  if (/your-project-ref|example\.(com|org)|localhost|127\.0\.0\.1/.test(url.hostname)) {
    problems.push(`${name} still points at a placeholder or local address: "${value}".`);
  }
};

requireHttpsUrl('EXPO_PUBLIC_SUPABASE_URL', 'Use your project URL from Supabase → Project Settings → API.');
requireHttpsUrl('EXPO_PUBLIC_TERMS_URL', 'Link your published Terms of Service so sign-up shows the consent line.');
requireHttpsUrl('EXPO_PUBLIC_PRIVACY_URL', 'Link your published privacy policy so sign-up shows the consent line.');

const key = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
if (!key) {
  problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set. Use the anon / publishable key.');
} else if (isSecretKey(key)) {
  problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is a SECRET (service_role) key. Anyone who downloads the app could read it. Use the anon / publishable key, and rotate the secret one.');
}

if (problems.length) {
  console.error('Release configuration is not ready:\n');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('\nSet these in .env (local builds) or as EAS environment variables (eas build).');
  process.exit(1);
}
console.log('check-release-env: Supabase, Terms and Privacy settings look ready for release.');

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function isSecretKey(value) {
  if (value.startsWith('sb_secret_')) return true;
  const payload = value.split('.')[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role';
  } catch {
    return false;
  }
}
