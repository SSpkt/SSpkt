import { Stack } from 'expo-router';

import { LoadingScreen } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

export default function TrainerLayout() {
  const { profile } = useAuth();
  // The root layout is already redirecting anyone who is not a trainer; render nothing of
  // the trainer area in the meantime.
  if (profile?.role !== 'trainer') return <LoadingScreen />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
