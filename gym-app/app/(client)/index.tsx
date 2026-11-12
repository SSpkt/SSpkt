import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { Banner, Button, Card, Checkbox, EmptyState, ProgressBar, Screen, SectionTitle, TextField } from '@/components/ui';
import { fetchTrainerName, fetchWorkoutsForClient, joinTrainer, setWorkoutCompleted } from '@/lib/api';
import type { Workout } from '@/lib/database.types';
import { friendlyError, joinErrorMessage } from '@/lib/errors';
import { useAsyncData } from '@/lib/useAsyncData';
import { validateInviteCode } from '@/lib/validation';
import { useAuth } from '@/providers/AuthProvider';
import { colors, space, type } from '@/theme';

export default function ClientDashboard() {
  const { profile, refreshProfile } = useAuth();
  const clientId = profile?.id ?? '';
  const trainerId = profile?.trainer_id ?? null;

  const loadDashboard = useCallback(async () => {
    const [workouts, trainerName] = await Promise.all([
      fetchWorkoutsForClient(clientId),
      trainerId ? fetchTrainerName(trainerId) : Promise.resolve(null),
    ]);
    return { workouts, trainerName };
  }, [clientId, trainerId]);

  const { data, setData, error, setError, loading, refreshing, reload, refresh } = useAsyncData(
    loadDashboard,
    'Could not load your workouts. Check your connection and try again.',
  );

  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const workouts = data?.workouts ?? [];
  const todo = workouts.filter((workout) => !workout.is_completed);
  const done = workouts.filter((workout) => workout.is_completed);
  const firstName = profile?.full_name.trim().split(/\s+/)[0];

  function replaceWorkout(next: Workout) {
    setData((current) =>
      current ? { ...current, workouts: current.workouts.map((workout) => (workout.id === next.id ? next : workout)) } : current,
    );
  }

  async function toggle(workout: Workout) {
    if (pending.has(workout.id)) return;
    const target = !workout.is_completed;
    setError(null);
    setPending((current) => new Set(current).add(workout.id));
    // Optimistic: tick immediately, then confirm with the server or roll back.
    replaceWorkout({ ...workout, is_completed: target });
    try {
      replaceWorkout(await setWorkoutCompleted(workout.id, target));
    } catch (caught) {
      replaceWorkout(workout);
      setError(friendlyError(caught, 'Could not update that workout. Please try again.'));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(workout.id);
        return next;
      });
    }
  }

  return (
    <Screen
      testID="client-dashboard"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void Promise.all([refresh(), refreshProfile()])}
          tintColor={colors.accent}
        />
      }>
      <Header title="Workouts" subtitle={firstName ? `Hi, ${firstName}` : 'Welcome'} showAccount />

      {error ? <Banner message={error} actionLabel="Retry" onAction={() => void reload()} testID="workouts-error" /> : null}

      {trainerId ? (
        data?.trainerName ? (
          <Text style={styles.coach} testID="coach-name">
            Coached by <Text style={styles.coachName}>{data.trainerName}</Text>
          </Text>
        ) : null
      ) : (
        <JoinTrainerCard onJoined={refreshProfile} />
      )}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      ) : workouts.length === 0 ? (
        error ? null : (
          <EmptyState
            icon="barbell-outline"
            title="No workouts assigned"
            message={
              trainerId
                ? "Your trainer hasn't assigned anything yet. Pull down to refresh."
                : 'Link with your trainer above and your workouts will show up here.'
            }
            testID="workouts-empty"
          />
        )
      ) : (
        <>
          <Card style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressCount} testID="progress-count">
                {done.length}
                <Text style={styles.progressTotal}> / {workouts.length}</Text>
              </Text>
              <Text style={styles.progressLabel}>{todo.length === 0 ? 'All done. Nice work.' : 'workouts completed'}</Text>
            </View>
            <ProgressBar value={done.length} total={workouts.length} />
          </Card>

          {todo.length > 0 ? (
            <>
              <SectionTitle>To do</SectionTitle>
              <View style={styles.list}>
                {todo.map((workout) => (
                  <WorkoutRow key={workout.id} workout={workout} busy={pending.has(workout.id)} onToggle={() => void toggle(workout)} />
                ))}
              </View>
            </>
          ) : null}

          {done.length > 0 ? (
            <>
              <SectionTitle>Completed</SectionTitle>
              <View style={styles.list}>
                {done.map((workout) => (
                  <WorkoutRow key={workout.id} workout={workout} busy={pending.has(workout.id)} onToggle={() => void toggle(workout)} />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function WorkoutRow({ workout, busy, onToggle }: { workout: Workout; busy: boolean; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const hasNotes = workout.notes.length > 0;

  return (
    <Card style={[styles.workout, workout.is_completed && styles.workoutDone]}>
      <Checkbox
        checked={workout.is_completed}
        busy={busy}
        onToggle={onToggle}
        label={`Mark ${workout.title} as ${workout.is_completed ? 'not done' : 'done'}`}
        testID={`workout-checkbox-${workout.id}`}
      />
      <Pressable
        style={styles.workoutText}
        disabled={!hasNotes}
        onPress={() => setExpanded((current) => !current)}
        role={hasNotes ? 'button' : undefined}
        aria-label={hasNotes ? `${workout.title}. ${expanded ? 'Collapse' : 'Expand'} notes` : undefined}>
        <Text style={[styles.workoutTitle, workout.is_completed && styles.workoutTitleDone]}>{workout.title}</Text>
        {hasNotes ? (
          <Text style={styles.notes} numberOfLines={expanded ? undefined : 3}>
            {workout.notes}
          </Text>
        ) : null}
      </Pressable>
    </Card>
  );
}

function JoinTrainerCard({ onJoined }: { onJoined: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeError = validateInviteCode(code);

  async function submit() {
    setSubmitted(true);
    setError(null);
    if (codeError) return;
    setJoining(true);
    try {
      const result = await joinTrainer(code);
      // ALREADY_LINKED means another device joined first; refreshing shows the right state.
      if (result.ok || result.error === 'ALREADY_LINKED') await onJoined();
      else setError(joinErrorMessage(result.error));
    } catch (caught) {
      setError(friendlyError(caught, 'Could not join this trainer. Please try again.'));
    } finally {
      setJoining(false);
    }
  }

  return (
    <Card style={styles.joinCard}>
      <Text style={styles.joinTitle}>Link with your trainer</Text>
      <Text style={styles.joinBody}>Ask your trainer for their invite code and enter it here.</Text>
      {error ? <Banner message={error} testID="join-error" /> : null}
      <TextField
        label="Invite code"
        value={code}
        onChangeText={setCode}
        error={submitted ? codeError : null}
        placeholder="AB12C-D34EF"
        autoCapitalize="characters"
        maxLength={16}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        testID="invite-code-input"
      />
      <Button label="Join trainer" icon="link" onPress={() => void submit()} loading={joining} testID="join-button" />
    </Card>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: space.xxl },
  list: { gap: space.md },
  coach: { ...type.body, color: colors.textMuted, marginTop: -space.md, marginBottom: space.lg },
  coachName: { color: colors.text, fontWeight: '600' },

  progressCard: { gap: space.md, backgroundColor: colors.surfaceRaised },
  progressHeader: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  progressCount: { fontSize: 34, lineHeight: 40, fontWeight: '800', color: colors.accent, letterSpacing: -1 },
  progressTotal: { fontSize: 20, fontWeight: '700', color: colors.textFaint },
  progressLabel: { ...type.body, color: colors.textMuted, flex: 1 },

  workout: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  workoutDone: { opacity: 0.7 },
  workoutText: { flex: 1, gap: space.xs },
  workoutTitle: { ...type.heading, color: colors.text, marginTop: 3 },
  workoutTitleDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  notes: { ...type.body, color: colors.textMuted },

  joinCard: { gap: space.md, backgroundColor: colors.surfaceRaised, marginBottom: space.lg },
  joinTitle: { ...type.heading, color: colors.text },
  joinBody: { ...type.body, color: colors.textMuted },
});
