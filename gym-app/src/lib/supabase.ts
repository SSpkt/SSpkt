import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { createChunkedStorage } from './chunkedStorage';
import { installCryptoPolyfill } from './cryptoPolyfill';
import type { Database } from './database.types';

installCryptoPolyfill();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

function looksLikeServiceKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(atob(key.split('.')[1] ?? ''));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

/** Why the app cannot talk to Supabase, or null when the configuration is usable. */
export const configError: string | null = (() => {
  if (!url || !anonKey) {
    return 'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file, then restart the dev server.';
  }
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    return 'EXPO_PUBLIC_SUPABASE_URL must be an https:// address.';
  }
  if (looksLikeServiceKey(anonKey)) {
    return 'EXPO_PUBLIC_SUPABASE_ANON_KEY contains a service-role key. That key bypasses all security and must never ship in the app. Use the anon (publishable) key and rotate the exposed one.';
  }
  return null;
})();

// Tokens live in the iOS Keychain / Android Keystore, never in plain storage, and are not
// copied into device backups. Browsers fall back to supabase-js's default (localStorage).
const nativeStorage = createChunkedStorage({
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) =>
    SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
});

export const supabase = createClient<Database>(
  configError ? 'http://localhost' : url,
  configError ? 'not-configured' : anonKey,
  {
    auth: {
      ...(Platform.OS === 'web' ? {} : { storage: nativeStorage }),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      // PKCE ties every emailed link to the device that asked for it, so a link crafted by
      // someone else cannot sign this device into their account.
      flowType: 'pkce',
    },
  },
);

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
