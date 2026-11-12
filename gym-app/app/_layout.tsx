import { DarkTheme, Stack, ThemeProvider, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Logo } from '@/components/Logo';
import { Banner, Button, LoadingScreen, Screen } from '@/components/ui';
import { configError } from '@/lib/supabase';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { colors, space, type } from '@/theme';

const navigationTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, border: colors.border, primary: colors.accent },
};

const HOME = {
  '(auth)': '/(auth)/sign-in',
  '(trainer)': '/(trainer)',
  '(client)': '/(client)',
  'reset-password': '/reset-password',
} as const;

type Destination = keyof typeof HOME;

export default function RootLayout() {
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="light" />
      {configError ? (
        <ConfigErrorScreen message={configError} />
      ) : (
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      )}
    </ThemeProvider>
  );
}

/**
 * Sends every user to the only area they are allowed in: signed-out users to the auth
 * screens, trainers to (trainer), clients to (client). This is navigation convenience only.
 * The actual access control is row-level security in the database.
 */
function RootNavigator() {
  const { status, profile, isRecovering } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navigationReady = useRootNavigationState()?.key != null;

  let destination: Destination | null = null;
  if (isRecovering) destination = 'reset-password';
  else if (status === 'signedOut') destination = '(auth)';
  else if (status === 'signedIn' && profile) destination = profile.role === 'trainer' ? '(trainer)' : '(client)';

  const current = segments[0] as string | undefined;
  const onSharedScreen = status === 'signedIn' && !isRecovering && current === 'account';
  const mustRedirect = destination !== null && current !== destination && !onSharedScreen;

  useEffect(() => {
    if (navigationReady && mustRedirect && destination) router.replace(HOME[destination]);
  }, [navigationReady, mustRedirect, destination, router]);

  if (status === 'profileError' && !isRecovering) return <ProfileErrorScreen />;

  return (
    <View style={styles.fill}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }} />
      {destination === null || mustRedirect ? (
        <View style={StyleSheet.absoluteFill}>
          <LoadingScreen />
        </View>
      ) : null}
    </View>
  );
}

function ProfileErrorScreen() {
  const { refreshProfile, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);
  return (
    <Screen scroll={false} testID="profile-error">
      <View style={styles.centered}>
        <Logo />
        <Text style={styles.title}>We couldn&apos;t load your profile</Text>
        <Text style={styles.body}>Check your connection and try again. If this keeps happening, sign out and back in.</Text>
        <Button
          label="Try again"
          icon="refresh"
          loading={retrying}
          testID="profile-retry"
          onPress={() => {
            setRetrying(true);
            void refreshProfile().finally(() => setRetrying(false));
          }}
        />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <Screen scroll={false} testID="config-error">
      <View style={styles.centered}>
        <Logo />
        <Text style={styles.title}>Almost there</Text>
        <Banner tone="info" message={message} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', gap: space.lg },
  title: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.textMuted },
});
