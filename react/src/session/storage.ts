/**
 * The three operations a session needs from a key-value store. Async because
 * the native implementations are: Expo's SecureStore has no synchronous API.
 */
export interface PyloStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createMemoryStorage(): PyloStorage {
  const store = new Map<string, string>();
  return {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => void store.set(key, value),
    removeItem: async (key) => void store.delete(key),
  };
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Persists to `localStorage`, falling back to memory where it is missing or
 * blocked — server rendering, and Safari's private mode, which throws on write.
 * Falling back means the session lasts the page's lifetime rather than failing
 * outright, so a read consults memory whenever the web store comes up empty.
 */
export function createLocalStorageAdapter(): PyloStorage {
  const web = (globalThis as { localStorage?: WebStorageLike }).localStorage;
  if (!web) return createMemoryStorage();

  const fallback = createMemoryStorage();
  return {
    getItem: async (key) => {
      try {
        const value = web.getItem(key);
        if (value !== null) return value;
      } catch {
        // fall through to memory
      }
      return fallback.getItem(key);
    },
    setItem: async (key, value) => {
      try {
        web.setItem(key, value);
      } catch {
        await fallback.setItem(key, value);
      }
    },
    removeItem: async (key) => {
      try {
        web.removeItem(key);
      } catch {
        // still clear the mirror below
      }
      await fallback.removeItem(key);
    },
  };
}
