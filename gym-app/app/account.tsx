import Constants from 'expo-constants';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { ConfirmDialog } from '@/components/Sheet';
import { Badge, Banner, Button, Card, Screen, SectionTitle, TextField } from '@/components/ui';
import { createBillingSession, deleteAccount, fetchPlan, fetchTrainerName, leaveTrainer, regenerateInviteCode, updateName } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsyncData } from '@/lib/useAsyncData';
import { limits, validateName } from '@/lib/validation';
import { useAuth } from '@/providers/AuthProvider';
import { colors, space, type } from '@/theme';

// Subscriptions are sold through Stripe on the web. The store apps must not link out to an
// external checkout, so the buttons only exist in the browser build.
const BILLING_ENABLED = Platform.OS === 'web' && process.env.EXPO_PUBLIC_BILLING_ENABLED === 'true';
const PRO_PRICE_LABEL = process.env.EXPO_PUBLIC_PRO_PRICE_LABEL;

type Dialog = 'leave' | 'regenerate' | 'delete' | null;

export default function Account() {
  const { profile, session, refreshProfile, signOut } = useAuth();
  const isTrainer = profile?.role === 'trainer';
  const trainerId = profile?.trainer_id ?? null;

  const loadDetails = useCallback(async () => {
    const [plan, trainerName] = await Promise.all([
      isTrainer ? fetchPlan() : Promise.resolve(null),
      trainerId ? fetchTrainerName(trainerId) : Promise.resolve(null),
    ]);
    return { plan, trainerName };
  }, [isTrainer, trainerId]);

  const { data, error, setError, reload } = useAsyncData(loadDetails, 'Could not load your account details.');

  const [name, setName] = useState(profile?.full_name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [working, setWorking] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  const nameError = validateName(name);
  const nameChanged = name.trim() !== (profile?.full_name ?? '');
  const plan = data?.plan ?? null;

  async function run(action: () => Promise<void>, failure: string, success?: string) {
    setError(null);
    setNotice(null);
    setWorking(true);
    try {
      await action();
      if (success) setNotice(success);
    } catch (caught) {
      setError(friendlyError(caught, failure));
    } finally {
      setWorking(false);
      setDialog(null);
      setDeleteConfirmation('');
    }
  }

  async function saveName() {
    if (!profile || nameError) return;
    setSavingName(true);
    setError(null);
    setNotice(null);
    try {
      await updateName(profile.id, name);
      await refreshProfile();
      setNotice('Name updated.');
    } catch (caught) {
      setError(friendlyError(caught, 'Could not save your name. Please try again.'));
    } finally {
      setSavingName(false);
    }
  }

  async function openBilling(action: 'checkout' | 'portal') {
    setBillingLoading(true);
    setError(null);
    try {
      // BILLING_ENABLED is web-only, so a same-tab redirect to Stripe is always available.
      window.location.assign(await createBillingSession(action));
    } catch (caught) {
      setError(friendlyError(caught, 'Could not open billing. Please try again.'));
    } finally {
      setBillingLoading(false);
    }
  }

  return (
    <>
      <Screen testID="account-screen">
        <Header title="Account" back />

        {error ? <Banner message={error} actionLabel="Retry" onAction={() => void reload()} testID="account-error" /> : null}
        {notice ? <Banner tone="success" message={notice} testID="account-notice" /> : null}

        <Card style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.email} numberOfLines={1}>
              {session?.user.email}
            </Text>
            <Badge label={isTrainer ? 'TRAINER' : 'CLIENT'} tone="accent" />
          </View>
          <TextField
            label="Full name"
            value={name}
            onChangeText={setName}
            error={nameChanged ? nameError : null}
            maxLength={limits.nameMax}
            autoCapitalize="words"
            autoComplete="name"
            testID="account-name-input"
          />
          {nameChanged ? (
            <Button
              label="Save name"
              onPress={() => void saveName()}
              loading={savingName}
              disabled={Boolean(nameError)}
              compact
              testID="save-name-button"
            />
          ) : null}
        </Card>

        {isTrainer && plan ? (
          <>
            <SectionTitle>Plan</SectionTitle>
            <Card style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.planName} testID="plan-name">
                  {plan.plan === 'pro' ? 'Pro' : 'Free'}
                </Text>
                <Badge label={plan.plan === 'pro' ? 'ACTIVE' : 'FREE'} tone={plan.plan === 'pro' ? 'success' : 'neutral'} />
              </View>
              <Text style={styles.body}>
                {plan.client_limit === null
                  ? `Unlimited clients. You currently coach ${plan.client_count}.`
                  : `${plan.client_count} of ${plan.client_limit} client spots used. Pro removes the limit.`}
              </Text>
              {plan.plan === 'pro' && plan.current_period_end ? (
                <Text style={styles.caption}>
                  {plan.cancel_at_period_end ? 'Ends on ' : 'Renews on '}
                  {new Date(plan.current_period_end).toLocaleDateString()}
                </Text>
              ) : null}
              {plan.status === 'past_due' ? (
                <Banner message="Your last payment failed. Update your payment method to keep Pro." />
              ) : null}
              {BILLING_ENABLED ? (
                plan.plan === 'pro' || plan.status === 'past_due' ? (
                  <Button label="Manage billing" variant="secondary" loading={billingLoading} onPress={() => void openBilling('portal')} testID="manage-billing" />
                ) : (
                  <Button
                    label={PRO_PRICE_LABEL ? `Upgrade to Pro · ${PRO_PRICE_LABEL}` : 'Upgrade to Pro'}
                    icon="flash"
                    loading={billingLoading}
                    onPress={() => void openBilling('checkout')}
                    testID="upgrade-button"
                  />
                )
              ) : null}
            </Card>

            <SectionTitle>Invite code</SectionTitle>
            <Card style={styles.card}>
              <Text style={styles.body}>
                Replace your code if it has been shared with the wrong people. Existing clients stay linked; the old code stops working.
              </Text>
              <Button label="Generate new code" variant="secondary" icon="refresh" onPress={() => setDialog('regenerate')} compact />
            </Card>
          </>
        ) : null}

        {!isTrainer && trainerId ? (
          <>
            <SectionTitle>Trainer</SectionTitle>
            <Card style={styles.card}>
              <Text style={styles.body}>
                You are linked with <Text style={styles.strong}>{data?.trainerName ?? 'your trainer'}</Text>.
              </Text>
              <Button label="Leave trainer" variant="secondary" onPress={() => setDialog('leave')} compact testID="leave-trainer" />
            </Card>
          </>
        ) : null}

        <SectionTitle>Session</SectionTitle>
        <Button
          label="Sign out"
          variant="secondary"
          icon="log-out-outline"
          loading={signingOut}
          onPress={() => {
            setSigningOut(true);
            void signOut().finally(() => setSigningOut(false));
          }}
          testID="sign-out-button"
        />

        <SectionTitle>Danger zone</SectionTitle>
        <Button label="Delete account" variant="danger" icon="trash-outline" onPress={() => setDialog('delete')} testID="delete-account-button" />

        <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
      </Screen>

      <ConfirmDialog
        visible={dialog === 'leave'}
        title="Leave your trainer?"
        message="They will no longer see your profile. You keep your workouts and can join a trainer again with an invite code."
        confirmLabel="Leave"
        destructive
        loading={working}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          void run(async () => {
            await leaveTrainer();
            await refreshProfile();
          }, 'Could not leave your trainer. Please try again.', 'You have left your trainer.')
        }
      />

      <ConfirmDialog
        visible={dialog === 'regenerate'}
        title="Generate a new code?"
        message="Your current invite code stops working immediately. Clients who already joined are not affected."
        confirmLabel="Generate"
        loading={working}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          void run(async () => {
            await regenerateInviteCode();
            await refreshProfile();
          }, 'Could not generate a new code. Please try again.', 'New invite code generated. Find it on your dashboard.')
        }
      />

      <ConfirmDialog
        visible={dialog === 'delete'}
        title="Delete your account?"
        message={
          isTrainer
            ? 'This permanently deletes your account, your client links and every workout you assigned. It cannot be undone.'
            : 'This permanently deletes your account and your workout history. It cannot be undone.'
        }
        confirmLabel="Delete forever"
        destructive
        loading={working}
        confirmDisabled={deleteConfirmation.trim().toUpperCase() !== 'DELETE'}
        onCancel={() => {
          setDialog(null);
          setDeleteConfirmation('');
        }}
        onConfirm={() =>
          void run(async () => {
            await deleteAccount();
            await signOut();
          }, 'Could not delete your account. Please try again.')
        }>
        <TextField
          label="Type DELETE to confirm"
          value={deleteConfirmation}
          onChangeText={setDeleteConfirmation}
          autoCapitalize="characters"
          testID="delete-confirm-input"
        />
      </ConfirmDialog>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  email: { ...type.heading, color: colors.text, flex: 1 },
  planName: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.textMuted },
  strong: { color: colors.text, fontWeight: '600' },
  caption: { ...type.caption, color: colors.textFaint },
  version: { ...type.caption, color: colors.textFaint, textAlign: 'center', marginTop: space.xxl },
});
