# @pylo/react

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
