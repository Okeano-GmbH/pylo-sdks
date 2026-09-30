import type { HandoffCrypto } from "@pylo/auth";
import type { OpenAuthSession } from "@pylo/react";

// Both modules call requireNativeModule on import, so they load only when sign-in runs.

export const openAuthSession: OpenAuthSession = async (url, returnUrl) => {
  const WebBrowser = await import("expo-web-browser");
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
  if (result.type === "success") return result.url;
  if (result.type === WebBrowser.WebBrowserResultType.LOCKED) {
    throw new Error("Another sign-in is already in progress");
  }
  return null;
};

export const expoHandoffCrypto: HandoffCrypto = {
  randomBytes: async (length) => (await import("expo-crypto")).getRandomBytes(length),
  sha256: async (data) => {
    const Crypto = await import("expo-crypto");
    return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data as Uint8Array<ArrayBuffer>);
  },
};
