import { Stack } from 'expo-router';

import { LoadingScreen } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

export default function ClientLayout() {
  const { profile } = useAuth();
  if (profile?.role !== 'client') return <LoadingScreen />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
