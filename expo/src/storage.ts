import * as SecureStore from "expo-secure-store";
import type { PyloStorage } from "@pylo/react";

// SecureStore keys allow only alphanumerics, `.`, `-` and `_`.
const sanitize = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * Keychain-backed storage. Its reads and writes are async, which is why the
 * session has a loading state at all.
 */
export function createSecureStorage(): PyloStorage {
  return {
    getItem: (key) => SecureStore.getItemAsync(sanitize(key)),
    setItem: async (key, value) => {
      await SecureStore.setItemAsync(sanitize(key), value);
    },
    removeItem: async (key) => {
      await SecureStore.deleteItemAsync(sanitize(key));
    },
  };
}
