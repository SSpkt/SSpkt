import { friendlyError, joinErrorMessage } from '../errors';

describe('friendlyError', () => {
  it('maps known auth error codes', () => {
    expect(friendlyError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('Incorrect email or password.');
    expect(friendlyError({ code: 'user_already_exists' })).toMatch(/already exists/);
    expect(friendlyError({ code: 'over_email_send_rate_limit' })).toMatch(/Too many emails/);
  });

  it('recognises network failures on every platform', () => {
    for (const message of ['Network request failed', 'Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
      expect(friendlyError(new TypeError(message))).toMatch(/No connection/);
    }
    expect(friendlyError({ name: 'AuthRetryableFetchError', message: '' })).toMatch(/No connection/);
  });

  it('maps permission, validation, rate-limit and expiry failures', () => {
    expect(friendlyError({ code: '42501', message: 'new row violates row-level security policy for table "workouts"' })).toBe(
      "You don't have permission to do that.",
    );
    expect(friendlyError({ code: '23514', message: 'violates check constraint "workouts_title_len"' })).toMatch(/too long or empty/);
    expect(friendlyError({ status: 429 })).toMatch(/Too many attempts/);
    expect(friendlyError({ code: 'PGRST301' })).toMatch(/session expired/);
  });

  it('explains why an account with a running subscription cannot be deleted', () => {
    expect(friendlyError({ code: 'P0001', message: 'ACTIVE_SUBSCRIPTION' })).toMatch(/Cancel your subscription/);
  });

  it('never passes raw server text through to the user', () => {
    const leaky = { code: 'XX000', message: 'relation "private.join_attempts" does not exist at 10.0.0.5' };
    expect(friendlyError(leaky)).toBe('Something went wrong. Please try again.');
    expect(friendlyError(leaky, 'Could not save.')).toBe('Could not save.');
  });

  it('copes with values that are not error objects', () => {
    for (const value of [null, undefined, 'boom', 42]) {
      expect(friendlyError(value)).toBe('Something went wrong. Please try again.');
    }
  });
});

describe('joinErrorMessage', () => {
  it('has a specific message for every code the database can return', () => {
    const codes = ['INVALID_CODE', 'TOO_MANY_ATTEMPTS', 'TRAINER_AT_CAPACITY', 'ALREADY_LINKED', 'NOT_A_CLIENT'];
    const messages = codes.map(joinErrorMessage);
    expect(new Set(messages).size).toBe(codes.length);
    expect(messages).not.toContain(joinErrorMessage('SOMETHING_NEW'));
  });
});
