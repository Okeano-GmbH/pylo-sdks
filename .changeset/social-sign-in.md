---
"@pylo/auth": minor
"@pylo/react": minor
"@pylo/expo": minor
"@pylo/auth-nextjs": minor
"@pylo/core": minor
---

Social sign-in with Google or Microsoft through the Pylo login broker.

- `@pylo/auth`: handoff primitives shared by the SDKs: verifier and challenge, the broker start URL, callback parsing, `safeRedirectPath`, and the `redeemLoginHandoff` mutation.
- `@pylo/react`: `signInWith(provider, { returnUrl })` on `usePyloAuth`, typed by the providers and return URLs codegen registers.
- `@pylo/expo`: `signInWith` runs the flow in the system browser. `expo-web-browser` and `expo-crypto` are new peer dependencies.
- `@pylo/auth-nextjs`: `createSocialStartRoute` and `createSocialCallbackRoute` start the flow and redeem the handoff on the server.
- `@pylo/core`: with `appId` in `pylo.config.ts`, `pylo generate` emits the app's enabled sign-in providers and return URLs and registers them on `PyloRegister`.
