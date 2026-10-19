# @pylo/react

## 0.9.0

### Minor Changes

- 712768b: Say login instead of sign-in, matching `login()`, `logout()` and `loggedIn()`. Renamed, with no aliases:

  - `usePyloAuth()`: `isSignedIn` → `isLoggedIn`, `signInWith` → `loginWith`, `completeSignIn` → `completeLogin`
  - `AuthError["code"]`: `"SIGN_IN_FAILED"` → `"LOGIN_FAILED"`
  - Session status: `"signedIn"` / `"signedOut"` → `"loggedIn"` / `"loggedOut"`
  - `createSessionStore` options: `onSignIn` / `onSignOut` → `onLogin` / `onLogout`
  - Types: `SocialSignIn` → `SocialLogin`, `SocialSignInResult` → `SocialLoginResult`

  Error messages now say "Login failed" and "Login was cancelled".

- 8b4d780: Pagination fields are selected like any other field, under the reserved `_pagination` key in `select`. The result carries exactly the fields you pick, and without `_pagination` none are requested. `pagination` still takes only the page arguments.

  ```ts
  const { data, pagination } = await client.contact.list({
    select: { id: true, _pagination: { has_more_pages: true } },
    pagination: { page: 2 },
  });
  pagination.has_more_pages; // `total` is neither fetched nor typed
  ```

  This applies to `<entity>.list()`, `usePyloList()` and nested hasMany relations. Previously, list queries always fetched every pagination field, and relations fetched them all whenever `pagination` was set. `events.list()` and `usePyloEventList()` have no `select`, so they take `_pagination` as an option. `usePyloInfiniteList()` always returns `current_page` and `has_more_pages`, and `_pagination` adds more fields.

  On entity lists, picking fewer fields also makes the query cheaper: the server only counts rows when you select `total`, `last_page` or `has_more_pages`, and for a top-level list with only `has_more_pages` the count is capped.

### Patch Changes

- Updated dependencies [712768b]
- Updated dependencies [8b4d780]
  - @pylo/auth@0.2.0
  - @pylo/core@0.9.0

## 0.8.0

### Minor Changes

- 1fd27b6: Social sign-in with Google or Microsoft through the Pylo login broker.

  - `@pylo/auth`: handoff primitives shared by the SDKs: verifier and challenge, the broker start URL, callback parsing, `safeRedirectPath`, and the `redeemLoginHandoff` mutation.
  - `@pylo/react`: `signInWith(provider, { returnUrl })` on `usePyloAuth`, typed by the providers and return URLs codegen registers.
  - `@pylo/expo`: `signInWith` runs the flow in the system browser. `expo-web-browser` and `expo-crypto` (`>=14`, Expo SDK 52+) are new peer dependencies. Install both, since Metro resolves them when it bundles. Both are native modules, but they only load when sign-in runs, so an existing binary keeps working and you only need a native rebuild before using social sign-in.
  - `@pylo/auth-nextjs`: `createSocialStartRoute` and `createSocialCallbackRoute` start the flow and redeem the handoff on the server.
  - `@pylo/core`: with `appId` in `pylo.config.ts`, `pylo generate` emits the app's enabled sign-in providers and return URLs and registers them on `PyloRegister`.

  `AuthError["code"]` gained `SIGN_IN_FAILED` and `CANCELLED`. An exhaustive `switch` over it needs cases for both.

### Patch Changes

- Updated dependencies [1fd27b6]
  - @pylo/auth@0.1.0
  - @pylo/core@0.8.0

## 0.7.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [129571a]
  - @pylo/core@0.7.0
