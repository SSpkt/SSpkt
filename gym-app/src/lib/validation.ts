export const limits = {
  nameMax: 80,
  passwordMin: 10,
  passwordMax: 72,
  titleMax: 120,
  notesMax: 4000,
  inviteCodeLength: 10,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email) return 'Enter your email address.';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < limits.passwordMin) return `Use at least ${limits.passwordMin} characters.`;
  // bcrypt, which Supabase Auth uses, ignores everything past 72 bytes.
  if (new TextEncoder().encode(value).length > limits.passwordMax) return 'Use a shorter password (72 bytes maximum).';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) return 'Include at least one letter and one number.';
  return null;
}

export function validateName(value: string): string | null {
  const name = value.trim();
  if (!name) return 'Enter your name.';
  if (name.length > limits.nameMax) return `Keep your name under ${limits.nameMax} characters.`;
  return null;
}

export function validateWorkoutTitle(value: string): string | null {
  const title = value.trim();
  if (!title) return 'Give the workout a title.';
  if (title.length > limits.titleMax) return `Keep the title under ${limits.titleMax} characters.`;
  return null;
}

export function validateWorkoutNotes(value: string): string | null {
  if (value.length > limits.notesMax) return `Keep notes under ${limits.notesMax} characters.`;
  return null;
}

/** Strips everything a user might type around an invite code: spaces, dashes, lower case. */
export function normalizeInviteCode(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export function validateInviteCode(value: string): string | null {
  const code = normalizeInviteCode(value);
  if (!code) return "Enter your trainer's invite code.";
  if (code.length !== limits.inviteCodeLength) return `Invite codes are ${limits.inviteCodeLength} characters long.`;
  return null;
}

/** `AB12CD34EF` -> `AB12C-D34EF`, easier to read aloud and type. */
export function formatInviteCode(code: string): string {
  const clean = normalizeInviteCode(code);
  return clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}

export function initials(name: string, fallback = '?'): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase() || fallback;
}
