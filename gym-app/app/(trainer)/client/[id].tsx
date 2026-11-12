import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AssignWorkoutSheet } from '@/components/AssignWorkoutSheet';
import { Header } from '@/components/Header';
import { ConfirmDialog } from '@/components/Sheet';
import { Avatar, Badge, Banner, Button, Card, EmptyState, IconButton, ProgressBar, Screen, SectionTitle } from '@/components/ui';
import { deleteWorkout, fetchClient, fetchWorkoutsForClient, removeClient } from '@/lib/api';
import type { Workout } from '@/lib/database.types';
import { friendlyError } from '@/lib/errors';
import { useAsyncData } from '@/lib/useAsyncData';
import { initials } from '@/lib/validation';
import { useAuth } from '@/providers/AuthProvider';
import { colors, space, type } from '@/theme';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ClientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const router = useRouter();
  const clientId = typeof id === 'string' && UUID_PATTERN.test(id) ? id : null;

  const loadClient = useCallback(async () => {
    if (!clientId) return { client: null, workouts: [] };
    const [client, workouts] = await Promise.all([fetchClient(clientId), fetchWorkoutsForClient(clientId)]);
    return { client, workouts };
  }, [clientId]);

  const { data, error, setError, loading, refreshing, reload, refresh } = useAsyncData(
    loadClient,
    'Could not load this client. Check your connection and try again.',
  );

  const [assigning, setAssigning] = useState(false);
  const [workoutToDelete, setWorkoutToDelete] = useState<Workout | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [working, setWorking] = useState(false);

  const client = data?.client ?? null;
  const workouts = data?.workouts ?? [];
  const completed = workouts.filter((workout) => workout.is_completed).length;
  const name = client ? client.full_name.trim() || client.email || 'Client' : 'Client';

  async function confirmDeleteWorkout() {
    if (!workoutToDelete) return;
    setWorking(true);
    try {
      await deleteWorkout(workoutToDelete.id);
      setWorkoutToDelete(null);
      await reload();
    } catch (caught) {
      setWorkoutToDelete(null);
      setError(friendlyError(caught, 'Could not delete the workout. Please try again.'));
    } finally {
      setWorking(false);
    }
  }

  async function confirmRemoveClient() {
    if (!client) return;
    setWorking(true);
    try {
      await removeClient(client.id);
      setConfirmingRemoval(false);
      if (router.canGoBack()) router.back();
      else router.replace('/(trainer)');
    } catch (caught) {
      setConfirmingRemoval(false);
      setError(friendlyError(caught, 'Could not remove this client. Please try again.'));
    } finally {
      setWorking(false);
    }
  }

  if (!loading && !client && !error) {
    return (
      <Screen testID="client-not-found">
        <Header title="Client" back />
        <EmptyState icon="person-remove-outline" title="Client not found" message="This person is no longer one of your clients." />
      </Screen>
    );
  }

  return (
    <>
      <Screen
        testID="client-detail"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}>
        <Header title={name} subtitle="Client" back />

        {error ? <Banner message={error} actionLabel="Retry" onAction={() => void reload()} testID="client-error" /> : null}

        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        ) : client ? (
          <>
            <Card style={styles.summary}>
              <View style={styles.summaryTop}>
                <Avatar label={initials(name)} size={52} />
                <View style={styles.flex}>
                  <Text style={styles.email} numberOfLines={1}>
                    {client.email}
                  </Text>
                  <Text style={styles.progressText}>
                    {workouts.length === 0 ? 'No workouts assigned yet' : `${completed} of ${workouts.length} workouts done`}
                  </Text>
                </View>
              </View>
              {workouts.length > 0 ? <ProgressBar value={completed} total={workouts.length} /> : null}
              <Button label="Assign workout" icon="add" onPress={() => setAssigning(true)} testID="assign-button" />
            </Card>

            <SectionTitle>Workouts</SectionTitle>
            {workouts.length === 0 ? (
              <EmptyState icon="barbell-outline" title="Nothing assigned" message={`Assign ${name} a first workout to get them started.`} />
            ) : (
              <View style={styles.list}>
                {workouts.map((workout) => (
                  <Card key={workout.id} style={styles.workout}>
                    <View style={styles.workoutHeader}>
                      <View style={styles.workoutTitleWrap}>
                        <Text style={styles.workoutTitle}>{workout.title}</Text>
                        <Badge label={workout.is_completed ? 'Completed' : 'To do'} tone={workout.is_completed ? 'success' : 'neutral'} />
                      </View>
                      <IconButton
                        icon="trash-outline"
                        label={`Delete ${workout.title}`}
                        color={colors.danger}
                        onPress={() => setWorkoutToDelete(workout)}
                        testID={`delete-workout-${workout.id}`}
                      />
                    </View>
                    {workout.notes ? <Text style={styles.notes}>{workout.notes}</Text> : null}
                  </Card>
                ))}
              </View>
            )}

            <View style={styles.dangerZone}>
              <Button label="Remove client" variant="danger" icon="person-remove-outline" onPress={() => setConfirmingRemoval(true)} />
            </View>
          </>
        ) : null}
      </Screen>

      <AssignWorkoutSheet
        client={assigning && client ? { id: client.id, name } : null}
        trainerId={profile?.id ?? ''}
        onClose={() => setAssigning(false)}
        onAssigned={() => {
          setAssigning(false);
          void reload();
        }}
      />

      <ConfirmDialog
        visible={workoutToDelete !== null}
        title="Delete workout?"
        message={`"${workoutToDelete?.title ?? ''}" will be removed for ${name} too. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        loading={working}
        onConfirm={() => void confirmDeleteWorkout()}
        onCancel={() => setWorkoutToDelete(null)}
      />

      <ConfirmDialog
        visible={confirmingRemoval}
        title="Remove client?"
        message={`${name} will be unlinked from you and you'll no longer see their profile. They keep their workout history and can rejoin with your invite code.`}
        confirmLabel="Remove"
        destructive
        loading={working}
        onConfirm={() => void confirmRemoveClient()}
        onCancel={() => setConfirmingRemoval(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  spinner: { marginTop: space.xxl },
  summary: { gap: space.lg },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  email: { ...type.heading, color: colors.text },
  progressText: { ...type.label, color: colors.textMuted, fontWeight: '500' },
  list: { gap: space.md },
  workout: { gap: space.md },
  workoutHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  workoutTitleWrap: { flex: 1, gap: space.sm },
  workoutTitle: { ...type.heading, color: colors.text },
  notes: { ...type.body, color: colors.textMuted },
  dangerZone: { marginTop: space.xxl },
});
