import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useState } from 'react';

import { AuthScaffold, authStyles } from '@/components/AuthScaffold';
import { Banner, Button, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { normalizeEmail, validateEmail } from '@/lib/validation';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const emailError = validateEmail(email);

  async function submit() {
    setSubmitted(true);
    setError(null);
    if (emailError) return;
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: Linking.createURL('/reset-password'),
    });
    setLoading(false);
    if (resetError) setError(friendlyError(resetError, 'Could not send the email. Please try again.'));
    else setSent(true);
  }

  return (
    <AuthScaffold title="Reset your password" subtitle="We'll email you a link to choose a new one." testID="forgot-password-screen">
      {error ? <Banner message={error} testID="auth-error" /> : null}
      {sent ? (
        // Deliberately the same message whether or not the address has an account.
        <Banner tone="success" message="If an account exists for that address, a reset link is on its way. Open it on this device." />
      ) : (
        <>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            error={submitted ? emailError : null}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
            inputMode="email"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            testID="email-input"
          />
          <Button label="Send reset link" onPress={() => void submit()} loading={loading} />
        </>
      )}
      <Link replace href="/(auth)/sign-in" style={[authStyles.link, { textAlign: 'center' }]}>
        Back to sign in
      </Link>
    </AuthScaffold>
  );
}
