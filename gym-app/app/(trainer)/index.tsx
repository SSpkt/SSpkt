import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';

import { AssignWorkoutSheet } from '@/components/AssignWorkoutSheet';
import { Header } from '@/components/Header';
import { APP_NAME } from '@/components/Logo';
import { Avatar, Badge, Banner, Button, Card, EmptyState, ProgressBar, Screen, SectionTitle } from '@/components/ui';
import { fetchClients, fetchPlan, type ClientSummary } from '@/lib/api';
import { formatInviteCode, initials } from '@/lib/validation';
import { useAsyncData } from '@/lib/useAsyncData';
import { useAuth } from '@/providers/AuthProvider';
import { colors, radius, space, type } from '@/theme';

export default function TrainerDashboard() {
  const { profile } = useAuth();
  const router = useRouter();
  const trainerId = profile?.id ?? '';

  const loadDashboard = useCallback(async () => {
    const [clients, plan] = await Promise.all([fetchClients(trainerId), fetchPlan()]);
    return { clients, plan };
  }, [trainerId]);

  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(
    loadDashboard,
    'Could not load your clients. Check your connection and try again.',
  );

  const [assignTo, setAssignTo] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const clients = data?.clients ?? [];
  const plan = data?.plan ?? null;
  const firstName = profile?.full_name.trim().split(/\s+/)[0];

  return (
    <>
      <Screen
        testID="trainer-dashboard"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}>
        <Header title="Clients" subtitle={firstName ? `Hi, ${firstName}` : 'Welcome'} showAccount />

        {error ? <Banner message={error} actionLabel="Retry" onAction={() => void reload()} testID="clients-error" /> : null}
        {notice ? <Banner tone="success" message={notice} testID="dashboard-notice" /> : null}

        <InviteCard code={profile?.invite_code ?? null} />

        {plan ? (
          <Pressable
            role="button"
            aria-label="Plan and billing"
            onPress={() => router.push('/account')}
            style={styles.planRow}
            testID="plan-row">
            <Badge label={plan.plan === 'pro' ? 'PRO' : 'FREE'} tone={plan.plan === 'pro' ? 'accent' : 'neutral'} />
            <Text style={styles.planText}>
              {plan.client_limit === null
                ? `${plan.client_count} ${plan.client_count === 1 ? 'client' : 'clients'} · unlimited`
                : `${plan.client_count} of ${plan.client_limit} client spots used`}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
        ) : null}

        <SectionTitle trailing={clients.length > 0 ? <Badge label={String(clients.length)} /> : null}>Your clients</SectionTitle>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        ) : clients.length === 0 && !error ? (
          <EmptyState
            icon="people-outline"
            title="No clients yet"
            message="Share your invite code. Clients enter it after signing up and appear here straight away."
            testID="clients-empty"
          />
        ) : (
          <View style={styles.list}>
            {clients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                onOpen={() => router.push({ pathname: '/(trainer)/client/[id]', params: { id: client.id } })}
                onAssign={() => setAssignTo({ id: client.id, name: displayName(client) })}
              />
            ))}
          </View>
        )}
      </Screen>

      <AssignWorkoutSheet
        client={assignTo}
        trainerId={trainerId}
        onClose={() => setAssignTo(null)}
        onAssigned={(workout) => {
          setNotice(`"${workout.title}" assigned to ${assignTo?.name ?? 'your client'}.`);
          setAssignTo(null);
          void reload();
        }}
      />
    </>
  );
}

function displayName(client: { full_name: string; email: string | null }): string {
  return client.full_name.trim() || client.email || 'Client';
}

function ClientCard({ client, onOpen, onAssign }: { client: ClientSummary; onOpen: () => void; onAssign: () => void }) {
  const name = displayName(client);
  return (
    <Card style={styles.clientCard}>
      <Pressable
        role="button"
        aria-label={`Open ${name}`}
        onPress={onOpen}
        style={styles.clientMain}
        testID={`client-row-${client.id}`}>
        <Avatar label={initials(name)} />
        <View style={styles.clientText}>
          <Text style={styles.clientName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.clientMeta} numberOfLines={1}>
            {client.total === 0 ? 'No workouts assigned' : `${client.completed} of ${client.total} workouts done`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      {client.total > 0 ? <ProgressBar value={client.completed} total={client.total} /> : null}
      <Button label="Assign workout" icon="add" variant="secondary" compact onPress={onAssign} testID={`assign-button-${client.id}`} />
    </Card>
  );
}

function InviteCard({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!code) return null;
  const formatted = formatInviteCode(code);

  return (
    <Card style={styles.inviteCard}>
      <Text style={styles.inviteLabel}>YOUR INVITE CODE</Text>
      <Text style={styles.inviteCode} selectable testID="invite-code">
        {formatted}
      </Text>
      <Text style={styles.inviteHelp}>Clients enter this code in the app to link with you.</Text>
      <View style={styles.inviteActions}>
        <Button
          label={copied ? 'Copied' : 'Copy'}
          icon={copied ? 'checkmark' : 'copy-outline'}
          variant="secondary"
          compact
          style={styles.flex}
          onPress={() => {
            void Clipboard.setStringAsync(formatted).then(() => setCopied(true));
          }}
          testID="copy-invite-code"
        />
        {Platform.OS !== 'web' ? (
          <Button
            label="Share"
            icon="share-outline"
            variant="secondary"
            compact
            style={styles.flex}
            onPress={() => {
              void Share.share({ message: `Join me on ${APP_NAME}. Sign up as a client and enter my invite code: ${formatted}` });
            }}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  spinner: { marginTop: space.xxl },
  list: { gap: space.md },

  inviteCard: { gap: space.sm, backgroundColor: colors.surfaceRaised, marginTop: space.md },
  inviteLabel: { ...type.overline, color: colors.textFaint },
  inviteCode: { fontSize: 30, fontWeight: '800', letterSpacing: 3, color: colors.accent, fontVariant: ['tabular-nums'] },
  inviteHelp: { ...type.body, color: colors.textMuted },
  inviteActions: { flexDirection: 'row', gap: space.md, marginTop: space.sm },

  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
    paddingHorizontal: space.lg,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planText: { ...type.label, color: colors.textMuted, flex: 1 },

  clientCard: { gap: space.md },
  clientMain: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  clientText: { flex: 1, gap: 2 },
  clientName: { ...type.heading, color: colors.text },
  clientMeta: { ...type.label, color: colors.textMuted, fontWeight: '500' },
});
