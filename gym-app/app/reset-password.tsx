import { useState } from 'react';

import { AuthScaffold } from '@/components/AuthScaffold';
import { Banner, Button, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { limits, validatePassword } from '@/lib/validation';
import { useAuth } from '@/providers/AuthProvider';

/** Reached only through an emailed recovery link; the root layout keeps everyone else out. */
export default function ResetPassword() {
  const { finishRecovery, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordError = validatePassword(password);

  async function submit() {
    setSubmitted(true);
    setError(null);
    if (passwordError) return;
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) setError(friendlyError(updateError, 'Could not update your password. Please try again.'));
    else finishRecovery();
  }

  return (
    <AuthScaffold title="Choose a new password" subtitle="You'll use it the next time you sign in." testID="reset-password-screen">
      {error ? <Banner message={error} testID="auth-error" /> : null}
      <TextField
        label="New password"
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
      <Button label="Save password" onPress={() => void submit()} loading={loading} />
      <Button label="Cancel" variant="ghost" onPress={() => void signOut()} />
    </AuthScaffold>
  );
}
