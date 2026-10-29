# @pylo/auth

## 0.2.1

### Patch Changes

- 099bcd0: `graphqlRequest` records the HTTP status on every error of a non-2xx response, and `isUnauthorizedError` treats any 401 as unauthorized. The API answers an undecodable refresh token with 401 and `INTERNAL_SERVER_ERROR`, which the middleware had taken for a transient failure, so it kept a dead session and retried the refresh on every request. The middleware also drops client-sent `x-pylo-auth-*` headers, so only it can hand route handlers a token or an auth flag.

## 0.2.0

### Minor Changes

- 712768b: Say login instead of sign-in, matching `login()`, `logout()` and `loggedIn()`. Renamed, with no aliases:

  - `usePyloAuth()`: `isSignedIn` → `isLoggedIn`, `signInWith` → `loginWith`, `completeSignIn` → `completeLogin`
  - `AuthError["code"]`: `"SIGN_IN_FAILED"` → `"LOGIN_FAILED"`
  - Session status: `"signedIn"` / `"signedOut"` → `"loggedIn"` / `"loggedOut"`
  - `createSessionStore` options: `onSignIn` / `onSignOut` → `onLogin` / `onLogout`
  - Types: `SocialSignIn` → `SocialLogin`, `SocialSignInResult` → `SocialLoginResult`

  Error messages now say "Login failed" and "Login was cancelled".

## 0.1.0

### Minor Changes

- 1fd27b6: Social sign-in with Google or Microsoft through the Pylo login broker.

  - `@pylo/auth`: handoff primitives shared by the SDKs: verifier and challenge, the broker start URL, callback parsing, `safeRedirectPath`, and the `redeemLoginHandoff` mutation.
  - `@pylo/react`: `signInWith(provider, { returnUrl })` on `usePyloAuth`, typed by the providers and return URLs codegen registers.
  - `@pylo/expo`: `signInWith` runs the flow in the system browser. `expo-web-browser` and `expo-crypto` (`>=14`, Expo SDK 52+) are new peer dependencies. Install both, since Metro resolves them when it bundles. Both are native modules, but they only load when sign-in runs, so an existing binary keeps working and you only need a native rebuild before using social sign-in.
  - `@pylo/auth-nextjs`: `createSocialStartRoute` and `createSocialCallbackRoute` start the flow and redeem the handoff on the server.
  - `@pylo/core`: with `appId` in `pylo.config.ts`, `pylo generate` emits the app's enabled sign-in providers and return URLs and registers them on `PyloRegister`.

  `AuthError["code"]` gained `SIGN_IN_FAILED` and `CANCELLED`. An exhaustive `switch` over it needs cases for both.

## 0.0.6

### Patch Changes

- fix: better error parsing and token refreshing periods

## 0.0.5

### Patch Changes

- fix ts error

## 0.0.4

### Patch Changes

- see commit

## 0.0.3

### Patch Changes

- fixes a bug in the core package
