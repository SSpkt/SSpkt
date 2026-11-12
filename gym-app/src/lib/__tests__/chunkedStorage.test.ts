import { CHUNK_SIZE, createChunkedStorage, splitIntoChunks, type KeyValueBackend } from '../chunkedStorage';

function memoryBackend() {
  const data = new Map<string, string>();
  const backend: KeyValueBackend = {
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => {
      // Mirror the real constraint: a Keychain entry cannot exceed 2048 bytes.
      if (new TextEncoder().encode(value).length > 2048) throw new Error('value too large');
      data.set(key, value);
    },
    deleteItemAsync: async (key) => {
      data.delete(key);
    },
  };
  return { data, backend };
}

const KEY = 'sb-project-auth-token';

describe('splitIntoChunks', () => {
  it('returns nothing for an empty string and one chunk for a short one', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('abc')).toEqual(['abc']);
  });

  it('reassembles to the original value', () => {
    const value = 'x'.repeat(CHUNK_SIZE * 3 + 17);
    const chunks = splitIntoChunks(value);
    expect(chunks).toHaveLength(4);
    expect(chunks.join('')).toBe(value);
  });

  it('never cuts an emoji in half', () => {
    const value = `${'x'.repeat(CHUNK_SIZE - 1)}😀${'y'.repeat(10)}`;
    const chunks = splitIntoChunks(value);
    expect(chunks.join('')).toBe(value);
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });
});

describe('createChunkedStorage', () => {
  it('round-trips a session larger than one keychain entry', async () => {
    const { backend } = memoryBackend();
    const storage = createChunkedStorage(backend);
    const session = JSON.stringify({ access_token: 'a'.repeat(1500), refresh_token: 'r'.repeat(40), name: 'Zoë 😀'.repeat(300) });

    await storage.setItem(KEY, session);
    expect(await storage.getItem(KEY)).toBe(session);
  });

  it('returns null when nothing is stored', async () => {
    const storage = createChunkedStorage(memoryBackend().backend);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('leaves no stale pieces behind when a shorter value replaces a longer one', async () => {
    const { data, backend } = memoryBackend();
    const storage = createChunkedStorage(backend);

    await storage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * 4));
    await storage.setItem(KEY, 'short');

    expect(await storage.getItem(KEY)).toBe('short');
    expect([...data.keys()].sort()).toEqual([`${KEY}.0`, `${KEY}.count`]);
  });

  it('removes every piece on sign-out', async () => {
    const { data, backend } = memoryBackend();
    const storage = createChunkedStorage(backend);

    await storage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * 3));
    await storage.removeItem(KEY);

    expect(data.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('treats an interrupted write as signed out rather than returning a corrupt session', async () => {
    const { data, backend } = memoryBackend();
    const storage = createChunkedStorage(backend);
    await storage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * 3));

    data.delete(`${KEY}.1`);
    expect(await storage.getItem(KEY)).toBeNull();

    data.set(`${KEY}.count`, 'garbage');
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('keeps different keys separate', async () => {
    const storage = createChunkedStorage(memoryBackend().backend);
    await storage.setItem('a', 'one');
    await storage.setItem('b', 'two');
    await storage.removeItem('a');
    expect(await storage.getItem('a')).toBeNull();
    expect(await storage.getItem('b')).toBe('two');
  });
});
