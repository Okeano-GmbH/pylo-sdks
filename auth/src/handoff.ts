import type { SocialProvider } from "./types.js";

export interface HandoffCrypto {
  randomBytes(length: number): Uint8Array | Promise<Uint8Array>;
  sha256(data: Uint8Array): Promise<ArrayBuffer>;
}

export const webHandoffCrypto: HandoffCrypto = {
  randomBytes: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
  sha256: (data) => globalThis.crypto.subtle.digest("SHA-256", data as BufferSource),
};

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createHandoffVerifier(
  crypto: HandoffCrypto = webHandoffCrypto,
): Promise<string> {
  return base64url(await crypto.randomBytes(32));
}

export async function createHandoffChallenge(
  verifier: string,
  crypto: HandoffCrypto = webHandoffCrypto,
): Promise<string> {
  const digest = await crypto.sha256(new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function buildSocialStartUrl(o: {
  endpoint: string;
  provider: SocialProvider;
  appId: string;
  returnUrl: string;
  challenge: string;
  redirect?: string;
  invite?: string;
}): string {
  const url = new URL(`/auth/${o.provider}/start`, o.endpoint);
  url.searchParams.set("app_id", o.appId);
  url.searchParams.set("return_url", o.returnUrl);
  url.searchParams.set("handoff_challenge", o.challenge);
  if (o.redirect) url.searchParams.set("redirect", o.redirect);
  if (o.invite) url.searchParams.set("invite", o.invite);
  return url.toString();
}

export function parseHandoffCallback(url: string): { code: string } | { error: string } | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const error = params.get("error");
  if (error) return { error };
  const code = params.get("code");
  return code ? { code } : null;
}

const PLACEHOLDER_ORIGIN = "http://x.invalid";

// The URL parser folds "\" and strips tabs like browsers do, which exposes "//host" smuggling.
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/")) return null;
  try {
    const url = new URL(value, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return null;
    const path = url.pathname + url.search + url.hash;
    // Dot-segment normalisation can leave a leading "//", which browsers read as protocol-relative.
    return path.startsWith("//") ? null : path;
  } catch {
    return null;
  }
}
