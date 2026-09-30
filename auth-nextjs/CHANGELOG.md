# @pylo/auth-nextjs

## 0.2.0

### Minor Changes

- 1fd27b6: Social sign-in with Google or Microsoft through the Pylo login broker.

  - `@pylo/auth`: handoff primitives shared by the SDKs: verifier and challenge, the broker start URL, callback parsing, `safeRedirectPath`, and the `redeemLoginHandoff` mutation.
  - `@pylo/react`: `signInWith(provider, { returnUrl })` on `usePyloAuth`, typed by the providers and return URLs codegen registers.
  - `@pylo/expo`: `signInWith` runs the flow in the system browser. `expo-web-browser` and `expo-crypto` (`>=14`, Expo SDK 52+) are new peer dependencies. Install both, since Metro resolves them when it bundles. Both are native modules, but they only load when sign-in runs, so an existing binary keeps working and you only need a native rebuild before using social sign-in.
  - `@pylo/auth-nextjs`: `createSocialStartRoute` and `createSocialCallbackRoute` start the flow and redeem the handoff on the server.
  - `@pylo/core`: with `appId` in `pylo.config.ts`, `pylo generate` emits the app's enabled sign-in providers and return URLs and registers them on `PyloRegister`.

  `AuthError["code"]` gained `SIGN_IN_FAILED` and `CANCELLED`. An exhaustive `switch` over it needs cases for both.

### Patch Changes

- a3be2c2: Fix the JSDoc examples: they imported from `@okeano-gmbh/pylo-auth-nextjs`, which does not exist on
  npm. The `createPyloProxy` example no longer carries its own `config.matcher` — that belongs to the
  setup guide, and the copy here had a broken escape.
- Updated dependencies [1fd27b6]
  - @pylo/auth@0.1.0

## 0.1.8

### Patch Changes

- 129571a: Add `@pylo/react` and `@pylo/expo`, and move `@pylo/nextjs` onto the shared hook
  factory.

  `@pylo/react` ships the fifteen hooks, a session provider with login, logout and
  automatic refresh, and a typed client, for single-page React apps.
  `@pylo/expo` re-exports it with SecureStore as the token store, and refetches
  stale queries when the app returns to the foreground.

  `@pylo/core` accepts a React Native file reference as an upload source and no
  longer assumes `process` exists, so it works in browser and Metro bundles.

  `@pylo/nextjs` keeps its public surface. Every package now declares a `default`
  export condition and exports `./package.json`.

## 0.1.7

### Patch Changes

- fix: better error parsing and token refreshing periods
- Updated dependencies
  - @pylo/auth@0.0.6

## 0.1.6

### Patch Changes

- internal config

## 0.1.5

### Patch Changes

- only clear cookies for failed refresh attempts due to invalid token

## 0.1.4

### Patch Changes

- fix ts error
- Updated dependencies
  - @pylo/auth@0.0.5

## 0.1.3

### Patch Changes

- support for next js api route import

## 0.1.2

### Patch Changes

- Updated dependencies
  - @pylo/auth@0.0.4

## 0.1.1

### Patch Changes

- fixes a bug in the core package
- Updated dependencies
  - @pylo/auth@0.0.3
