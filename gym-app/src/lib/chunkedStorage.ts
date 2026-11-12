/**
 * Supabase sessions are larger than the ~2 KB a single Keychain/Keystore entry can hold, so
 * the value is split across several entries. `backend` is expo-secure-store in the app.
 */
export type KeyValueBackend = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

// 600 UTF-16 code units is at most 1800 bytes of UTF-8, safely under the 2048-byte limit.
export const CHUNK_SIZE = 600;

export function splitIntoChunks(value: string, size = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + size, value.length);
    const lastUnit = value.charCodeAt(end - 1);
    // Never cut an emoji (surrogate pair) in half.
    if (end < value.length && lastUnit >= 0xd800 && lastUnit <= 0xdbff) end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

const countKey = (key: string) => `${key}.count`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

async function readCount(backend: KeyValueBackend, key: string): Promise<number> {
  const raw = await backend.getItemAsync(countKey(key));
  const count = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export function createChunkedStorage(backend: KeyValueBackend) {
  return {
    async getItem(key: string): Promise<string | null> {
      const count = await readCount(backend, key);
      if (count === 0) return null;
      const chunks = await Promise.all(
        Array.from({ length: count }, (_, i) => backend.getItemAsync(chunkKey(key, i))),
      );
      // A missing piece means a write was interrupted; treat the session as absent.
      if (chunks.some((chunk) => chunk === null)) return null;
      return chunks.join('');
    },

    async setItem(key: string, value: string): Promise<void> {
      const previousCount = await readCount(backend, key);
      const chunks = splitIntoChunks(value);
      // Invalidate first so a crash mid-write can never yield a mix of old and new pieces.
      await backend.deleteItemAsync(countKey(key));
      for (let i = 0; i < chunks.length; i++) {
        await backend.setItemAsync(chunkKey(key, i), chunks[i]);
      }
      for (let i = chunks.length; i < previousCount; i++) {
        await backend.deleteItemAsync(chunkKey(key, i));
      }
      await backend.setItemAsync(countKey(key), String(chunks.length));
    },

    async removeItem(key: string): Promise<void> {
      const count = await readCount(backend, key);
      await backend.deleteItemAsync(countKey(key));
      for (let i = 0; i < count; i++) {
        await backend.deleteItemAsync(chunkKey(key, i));
      }
    },
  };
}
