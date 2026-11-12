import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { fetchProfile } from '@/lib/api';
import { extractAuthCode } from '@/lib/authLinks';
import type { Profile } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

type AuthStatus =
  | 'loading' // restoring the session or loading the profile
  | 'signedOut'
  | 'signedIn' // session and profile both present
  | 'profileError'; // signed in but the profile could not be loaded

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  /** True after the user opened a password-reset link and must choose a new password. */
  isRecovering: boolean;
  finishRecovery: () => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // Tagged with the user it belongs to, so a stale profile can never be shown for a new user.
  const [loaded, setLoaded] = useState<{ userId: string; profile: Profile | null; failed: boolean } | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const latestUserId = useRef<string | null>(null);

  useEffect(() => {
    // supabase-js fires INITIAL_SESSION once storage has been read, so this one listener
    // covers startup, sign-in, token refresh and sign-out.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setSessionLoaded(true);
      if (event === 'PASSWORD_RECOVERY') setIsRecovering(true);
      if (event === 'SIGNED_OUT') setIsRecovering(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Emailed links (confirm address, reset password) reopen the app with a one-time code.
  // Browsers are handled by supabase-js itself; on native the exchange is done here. It only
  // succeeds on the device that requested the email, because the PKCE verifier lives there.
  const linkingUrl = Linking.useLinkingURL();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const code = extractAuthCode(linkingUrl);
    if (code) void supabase.auth.exchangeCodeForSession(code).catch(() => undefined);
  }, [linkingUrl]);

  const userId = session?.user.id ?? null;

  const loadProfile = useCallback(
    (id: string) =>
      fetchProfile(id).then(
        (profile) => {
          if (latestUserId.current !== id) return; // the user changed while this was in flight
          setLoaded({ userId: id, profile, failed: profile === null });
        },
        () => {
          if (latestUserId.current !== id) return;
          // A failed refresh keeps the profile we already had; only a first load can fail hard.
          setLoaded((previous) => ({ userId: id, profile: previous?.userId === id ? previous.profile : null, failed: true }));
        },
      ),
    [],
  );

  useEffect(() => {
    latestUserId.current = userId;
    if (userId) void loadProfile(userId);
  }, [userId, loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (userId) await loadProfile(userId);
  }, [userId, loadProfile]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    // If the server could not be reached, still clear this device so nobody stays signed in.
    if (error) await supabase.auth.signOut({ scope: 'local' });
  }, []);

  const finishRecovery = useCallback(() => setIsRecovering(false), []);

  const value = useMemo<AuthState>(() => {
    const current = loaded && loaded.userId === userId ? loaded : null;
    const profile = current?.profile ?? null;
    let status: AuthStatus = 'loading';
    if (sessionLoaded) {
      if (!session) status = 'signedOut';
      else if (profile) status = 'signedIn';
      else if (current?.failed) status = 'profileError';
    }
    return { status, session, profile, isRecovering, finishRecovery, refreshProfile, signOut };
  }, [sessionLoaded, session, userId, loaded, isRecovering, finishRecovery, refreshProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
