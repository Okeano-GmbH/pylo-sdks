import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import type { HandoffCrypto } from "@pylo/auth";
import type { OpenAuthSession } from "@pylo/react";

export const openAuthSession: OpenAuthSession = async (url, returnUrl) => {
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
  return result.type === "success" ? result.url : null;
};

export const expoHandoffCrypto: HandoffCrypto = {
  randomBytes: (length) => Crypto.getRandomBytes(length),
  sha256: (data) =>
    Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data as Uint8Array<ArrayBuffer>),
};
