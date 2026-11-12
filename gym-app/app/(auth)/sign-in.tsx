import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthScaffold, authStyles } from '@/components/AuthScaffold';
import { Banner, Button, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { normalizeEmail, validateEmail } from '@/lib/validation';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailError = validateEmail(email);
  const passwordError = password ? null : 'Enter your password.';

  async function submit() {
    setSubmitted(true);
    setError(null);
    if (emailError || passwordError) return;
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
    setLoading(false);
    // On success the auth listener takes over and the root layout routes by role.
    if (signInError) setError(friendlyError(signInError, 'Could not sign in. Please try again.'));
  }

  return (
    <AuthScaffold title="Welcome back" subtitle="Sign in to pick up where you left off." testID="sign-in-screen">
      {error ? <Banner message={error} testID="auth-error" /> : null}
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
        secure
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        testID="password-input"
      />
      <Button label="Sign in" onPress={() => void submit()} loading={loading} testID="sign-in-button" />
      <View style={authStyles.linkRow}>
        <Link replace href="/(auth)/forgot-password" style={authStyles.link}>
          Forgot password?
        </Link>
      </View>
      <View style={authStyles.linkRow}>
        <Text style={authStyles.linkText}>New here?</Text>
        <Link replace href="/(auth)/sign-up" style={authStyles.link} testID="go-to-sign-up">
          Create an account
        </Link>
      </View>
    </AuthScaffold>
  );
}
