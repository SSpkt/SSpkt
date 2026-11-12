import {
  formatInviteCode,
  initials,
  normalizeEmail,
  normalizeInviteCode,
  validateEmail,
  validateInviteCode,
  validateName,
  validatePassword,
  validateWorkoutNotes,
  validateWorkoutTitle,
} from '../validation';

describe('email', () => {
  it('normalises case and surrounding whitespace', () => {
    expect(normalizeEmail('  Tara@Example.COM ')).toBe('tara@example.com');
  });

  it.each(['tara@example.com', 'a.b+tag@sub.example.co.uk', '  padded@example.com  '])('accepts %s', (value) => {
    expect(validateEmail(value)).toBeNull();
  });

  it.each(['', '   ', 'tara', 'tara@', '@example.com', 'tara@example', 'two words@example.com', `${'a'.repeat(250)}@example.com`])(
    'rejects %p',
    (value) => {
      expect(validateEmail(value)).not.toBeNull();
    },
  );
});

describe('password', () => {
  it('accepts a long password with a letter and a number', () => {
    expect(validatePassword('correct-horse-42')).toBeNull();
  });

  it.each([
    ['too short', 'abc123'],
    ['nine characters', 'abcdefg12'],
    ['no number', 'abcdefghijkl'],
    ['no letter', '123456789012'],
  ])('rejects a password that is %s', (_, value) => {
    expect(validatePassword(value)).not.toBeNull();
  });

  it('rejects passwords longer than the 72 bytes bcrypt actually uses', () => {
    expect(validatePassword(`a1${'x'.repeat(71)}`)).not.toBeNull();
    // 25 four-byte emoji are only 50 UTF-16 units but 100 bytes.
    expect(validatePassword(`a1${'😀'.repeat(25)}`)).not.toBeNull();
    expect(validatePassword(`a1${'x'.repeat(70)}`)).toBeNull();
  });
});

describe('name', () => {
  it('requires a non-blank name of at most 80 characters', () => {
    expect(validateName('Tara Trainer')).toBeNull();
    expect(validateName('   ')).not.toBeNull();
    expect(validateName('x'.repeat(80))).toBeNull();
    expect(validateName('x'.repeat(81))).not.toBeNull();
  });
});

describe('workout fields', () => {
  it('requires a title of 1 to 120 characters after trimming', () => {
    expect(validateWorkoutTitle('Leg day')).toBeNull();
    expect(validateWorkoutTitle('  ')).not.toBeNull();
    expect(validateWorkoutTitle('x'.repeat(120))).toBeNull();
    expect(validateWorkoutTitle('x'.repeat(121))).not.toBeNull();
  });

  it('allows empty notes and caps them at 4000 characters', () => {
    expect(validateWorkoutNotes('')).toBeNull();
    expect(validateWorkoutNotes('x'.repeat(4000))).toBeNull();
    expect(validateWorkoutNotes('x'.repeat(4001))).not.toBeNull();
  });
});

describe('invite code', () => {
  it('strips separators and upper-cases', () => {
    expect(normalizeInviteCode(' ab12c-d34ef ')).toBe('AB12CD34EF');
  });

  it('formats for display and round-trips', () => {
    expect(formatInviteCode('AB12CD34EF')).toBe('AB12C-D34EF');
    expect(normalizeInviteCode(formatInviteCode('AB12CD34EF'))).toBe('AB12CD34EF');
    expect(formatInviteCode('AB1')).toBe('AB1');
  });

  it('requires exactly 10 characters', () => {
    expect(validateInviteCode('AB12C-D34EF')).toBeNull();
    expect(validateInviteCode('')).not.toBeNull();
    expect(validateInviteCode('AB12C')).not.toBeNull();
    expect(validateInviteCode('AB12CD34EF0')).not.toBeNull();
  });
});

describe('initials', () => {
  it('uses the first and last name', () => {
    expect(initials('Tara Trainer')).toBe('TT');
    expect(initials('  cleo   anne  client ')).toBe('CC');
    expect(initials('Madonna')).toBe('M');
  });

  it('falls back when there is no name and keeps emoji intact', () => {
    expect(initials('   ')).toBe('?');
    expect(initials('😀 Smith')).toBe('😀S');
  });
});
