import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthScaffold, authStyles } from '@/components/AuthScaffold';
import { Banner, Button, Segmented, TextField } from '@/components/ui';
import type { Role } from '@/lib/database.types';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { limits, normalizeEmail, validateEmail, validateName, validatePassword } from '@/lib/validation';

const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL;
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL;

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('client');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  const nameError = validateName(name);
  const emailError = validateEmail(email);
  const passwordError = validatePassword(password);

  async function submit() {
    setSubmitted(true);
    setError(null);
    if (nameError || emailError || passwordError) return;
    setLoading(true);
    const address = normalizeEmail(email);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: address,
      password,
      options: {
        // The database trigger reads these, whitelists the role and creates the profile.
        data: { full_name: name.trim(), role },
        emailRedirectTo: Linking.createURL('/'),
      },
    });
    setLoading(false);
    if (signUpError) {
      setError(friendlyError(signUpError, 'Could not create your account. Please try again.'));
      return;
    }
    // With email confirmation on, there is no session until the link is opened.
    if (!data.session) setConfirmationSentTo(address);
  }

  if (confirmationSentTo) {
    return (
      <AuthScaffold title="Check your inbox" subtitle={`We sent a confirmation link to ${confirmationSentTo}.`} testID="confirm-email-screen">
        <Banner tone="info" message="Open the link on this device to finish setting up your account, then sign in." />
        <Link replace href="/(auth)/sign-in" style={authStyles.link}>
          Back to sign in
        </Link>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold title="Create your account" subtitle="Coach clients or follow your own programme." testID="sign-up-screen">
      {error ? <Banner message={error} testID="auth-error" /> : null}
      <Segmented
        label="I am a"
        value={role}
        onChange={setRole}
        options={[
          { value: 'client', label: 'Client', icon: 'body-outline' },
          { value: 'trainer', label: 'Trainer', icon: 'clipboard-outline' },
        ]}
      />
      <TextField
        label="Full name"
        value={name}
        onChangeText={setName}
        error={submitted ? nameError : null}
        maxLength={limits.nameMax}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        testID="name-input"
      />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={submitted ? emailError : null}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="username"
        inputMode="email"
        returnKeyType="next"
        testID="email-input"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={submitted ? passwordError : null}
        hint={`At least ${limits.passwordMin} characters, with a letter and a number.`}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        testID="password-input"
      />
      <Button label="Create account" onPress={() => void submit()} loading={loading} testID="sign-up-button" />
      {TERMS_URL && PRIVACY_URL ? (
        <Text style={authStyles.legal}>
          By creating an account you agree to our{' '}
          <Text style={authStyles.link} onPress={() => void Linking.openURL(TERMS_URL)}>
            Terms
          </Text>{' '}
          and{' '}
          <Text style={authStyles.link} onPress={() => void Linking.openURL(PRIVACY_URL)}>
            Privacy Policy
          </Text>
          .
        </Text>
      ) : null}
      <View style={authStyles.linkRow}>
        <Text style={authStyles.linkText}>Already have an account?</Text>
        <Link replace href="/(auth)/sign-in" style={authStyles.link} testID="go-to-sign-in">
          Sign in
        </Link>
      </View>
    </AuthScaffold>
  );
}
