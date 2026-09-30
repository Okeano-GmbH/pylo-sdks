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
- `@pylo/expo`: `signInWith` runs the flow in the system browser. `expo-web-browser` and `expo-crypto` (`>=14`, Expo SDK 52+) are new peer dependencies. Install both, since Metro resolves them when it bundles. Both are native modules, but they only load when sign-in runs, so an existing binary keeps working and you only need a native rebuild before using social sign-in.
- `@pylo/auth-nextjs`: `createSocialStartRoute` and `createSocialCallbackRoute` start the flow and redeem the handoff on the server.
- `@pylo/core`: with `appId` in `pylo.config.ts`, `pylo generate` emits the app's enabled sign-in providers and return URLs and registers them on `PyloRegister`.

`AuthError["code"]` gained `SIGN_IN_FAILED` and `CANCELLED`. An exhaustive `switch` over it needs cases for both.
