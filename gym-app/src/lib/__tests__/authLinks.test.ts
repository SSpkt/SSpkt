import { extractAuthCode } from '../authLinks';

describe('extractAuthCode', () => {
  it('reads the code from native and web links', () => {
    expect(extractAuthCode('trainerops://reset-password?code=0f1e2d3c-4b5a-6978-8695-a4b3c2d1e0f9')).toBe('0f1e2d3c-4b5a-6978-8695-a4b3c2d1e0f9');
    expect(extractAuthCode('https://app.example.com/?foo=1&code=abcDEF_123-xyz#section')).toBe('abcDEF_123-xyz');
  });

  it('returns null when there is no usable code', () => {
    for (const url of [null, undefined, '', 'trainerops://', 'trainerops://reset-password', 'trainerops://x?other=1', 'trainerops://x?code=']) {
      expect(extractAuthCode(url)).toBeNull();
    }
  });

  it('ignores codes in the fragment and codes with unexpected characters', () => {
    expect(extractAuthCode('trainerops://x#code=abcdefgh1234')).toBeNull();
    expect(extractAuthCode('trainerops://x?code=short')).toBeNull();
    expect(extractAuthCode('trainerops://x?code=abcdefgh%20ijkl')).toBeNull();
    expect(extractAuthCode('trainerops://x?code=%E0%A4%A')).toBeNull();
    expect(extractAuthCode(`trainerops://x?code=${'a'.repeat(129)}`)).toBeNull();
  });
});
