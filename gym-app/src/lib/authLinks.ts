/**
 * Pulls the one-time PKCE code out of an emailed link such as
 * `trainerops://reset-password?code=...`. Returns null for anything that is not shaped like one.
 */
export function extractAuthCode(url: string | null | undefined): string | null {
  if (!url) return null;
  const query = url.split('#')[0].split('?')[1];
  if (!query) return null;
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key === 'code') {
      let code: string;
      try {
        code = decodeURIComponent(value);
      } catch {
        return null;
      }
      return /^[A-Za-z0-9_-]{8,128}$/.test(code) ? code : null;
    }
  }
  return null;
}
