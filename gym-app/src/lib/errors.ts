type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; name?: unknown };

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Confirm your email address first. Check your inbox for the link.',
  user_already_exists: 'An account with this email already exists. Try signing in.',
  email_exists: 'An account with this email already exists. Try signing in.',
  weak_password: 'That password is too easy to guess. Choose a stronger one.',
  same_password: 'Choose a password you have not used before.',
  over_email_send_rate_limit: 'Too many emails requested. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a moment and try again.',
  signup_disabled: 'New sign-ups are currently closed.',
  user_banned: 'This account has been suspended.',
  session_expired: 'Your session expired. Sign in again.',
  session_not_found: 'Your session expired. Sign in again.',
  otp_expired: 'That link has expired. Request a new one.',
  captcha_failed: 'Verification failed. Try again.',
};

const JOIN_MESSAGES: Record<string, string> = {
  INVALID_CODE: "That code doesn't match any trainer. Check it and try again.",
  TOO_MANY_ATTEMPTS: 'Too many incorrect codes. Try again in an hour.',
  TRAINER_AT_CAPACITY: "Your trainer's plan is full. Ask them to upgrade so you can join.",
  ALREADY_LINKED: 'You are already linked to a trainer.',
  NOT_A_CLIENT: 'Only client accounts can join a trainer.',
};

export function joinErrorMessage(code: string): string {
  return JOIN_MESSAGES[code] ?? 'Could not join this trainer. Try again.';
}

/**
 * Turns anything thrown by supabase-js into a sentence that is safe to show a user. Raw
 * database and server messages are never passed through: they can leak schema details.
 */
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error || typeof error !== 'object') return fallback;
  const { message, code, status, name } = error as ErrorLike;
  const text = typeof message === 'string' ? message : '';

  if (typeof code === 'string' && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (text === 'ACTIVE_SUBSCRIPTION') {
    return 'Cancel your subscription before deleting your account, so you are not billed again.';
  }
  if (name === 'AuthRetryableFetchError' || /network request failed|failed to fetch|load failed|networkerror/i.test(text)) {
    return 'No connection. Check your internet and try again.';
  }
  if (code === '42501' || status === 403) return "You don't have permission to do that.";
  if (code === '23514') return 'Some of that text is too long or empty. Shorten it and try again.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (code === 'PGRST301' || status === 401) return 'Your session expired. Sign in again.';
  return fallback;
}
