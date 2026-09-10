# React and Expo SDK

Date: 2026-09-10
Status: approved, ready for implementation planning

## Problem

Pylo ships SDKs for Next.js and Node. Apps built with Expo or with a plain
single-page React setup have no supported path. The Next.js package cannot serve
them: its auth lives entirely in httpOnly cookies, middleware, and server
actions, and its hooks reach the API by posting to a route handler that only
exists inside a Next app.

Nearly everything below that layer is already portable. `@pylo/core` holds the
entity client, query and mutation builders, the type system, and the upload
flow, with no Next.js in it and only one Node-ism in the runtime path.
`@pylo/auth` holds token decoding, expiry policy, and the GraphQL request
wrapper. The codegen and CLI are dev-time and framework-neutral.

## Goals

- A supported SDK for Expo apps and for single-page React apps.
- One implementation of the hook logic, not one per framework.
- Session management that works without a server, since neither target has one.
- A package boundary that can absorb native features later without moving
  anyone's imports.

## Non-goals for this project

- A backend-for-frontend transport for SPAs that do have a server. Considered
  and deferred.
- Offline query persistence.
- React Native app-focus wiring for TanStack Query. Documented, not shipped.
- Runtime end-to-end tests against a live API.
- Native sign-in, passkeys, or native analytics. These are why `@pylo/expo`
  exists now, but none ship in this release.

## Decisions

### Package layout

Five packages.

```
@pylo/auth ──> @pylo/core ──> @pylo/react ──> @pylo/expo
                                          └─> @pylo/nextjs

@pylo/auth ──> @pylo/auth-nextjs ──> @pylo/nextjs
@pylo/auth ──> @pylo/core ──> @pylo/node
```

`@pylo/react` is the new shared layer and a product in its own right, aimed at
Vite and other single-page apps. It owns the hook factory, the session provider,
the direct transport, and the localStorage adapter. Peer dependencies on React
and TanStack Query. No platform-specific dependency.

`@pylo/expo` re-exports that surface with SecureStore preconfigured, so an Expo
app passes no storage prop. Peer dependency on `expo-secure-store`.

`@pylo/nextjs` keeps its public surface unchanged. Its `hooks` entry becomes a
call to the shared factory with a transport that posts to the route handler. Its
`server`, `api`, and `codegen` entries do not change.

Both wrappers take `@pylo/react` as a regular dependency rather than a peer, so
installs stay at one package. Versions move in lockstep through changesets so
the resolver collapses them to a single copy. This matters because the session
provider uses React context and two copies break it silently. The Node fixture
asserts a single resolved instance.

Rationale for a separate `@pylo/expo` rather than a subpath on `@pylo/react`:
vendors split their packages when native modules are involved and do not
otherwise. Clerk, Sentry, PostHog, Auth0, and Appwrite all ship a React Native
package. Supabase and Convex, whose clients are pure JavaScript over HTTP, ship
one package. Pylo is in the second group today but not for long: Google and
Microsoft sign-in need a native auth browser, passkeys need platform
authenticator APIs, and a PostHog-alike over Pylo events needs device metadata
and an offline queue. Creating the package now costs one thin re-export.
Migrating Expo users off `@pylo/react` later is a breaking change to every app's
imports, arriving at exactly the moment those apps are also adopting native
modules.

### Session layer

`PyloProvider` owns tokens and session state. The app owns the QueryClient,
matching what Next.js apps do today. The provider must sit inside
`QueryClientProvider` because logout clears the query cache.

```tsx
<QueryClientProvider client={queryClient}>
  <PyloProvider appId={...}>
    <App />
  </PyloProvider>
</QueryClientProvider>
```

```ts
const { isLoading, isSignedIn, user, login, logout, getToken } = usePyloAuth()
```

Storage is an interface of three async methods: get, set, remove. SecureStore
exposes exactly this and a localStorage adapter satisfies it trivially. Keys are
namespaced, with a prefix option for apps holding more than one session.

Boot reads storage before rendering anything auth-dependent, and `isLoading`
stays true until it resolves. On native this is load-bearing: SecureStore is
async, and without it an already-signed-in user sees a login screen flash.

Token freshness has two halves, both in this release:

- Proactive. Before each request the session checks `shouldRefreshToken`, whose
  buffer already scales to the token's own lifetime. Refresh is single-flight:
  ten hooks mounting together produce one refresh.
- Reactive. A request returning unauthenticated triggers one refresh and one
  retry. Without it, a token expiring mid-session surfaces as a random failed
  query.

Refresh failure is classified, not assumed, reusing the rule already proven in
`auth-nextjs/src/server.ts`. Only a rejected refresh token ends the session and
clears storage. A transient server error leaves the session intact so the next
request retries, which is what stops a backend deploy from signing out every
mobile user at once.

The escape hatch is the same provider. Pass `getToken` instead of storage and
the provider skips login, logout, and refresh, forwarding the supplied token to
the client. This covers apps whose auth lives elsewhere. It is the same seam
Clerk exposes through `useAuth().getToken`.

`user` comes from the existing me query, run through TanStack Query and enabled
only while signed in, so it caches and refetches like everything else rather
than being a second state machine.

### Token storage

RFC 10017, the current IETF best practice for browser-based apps, ranks
backend-for-frontend first: tokens never reach JavaScript and the browser holds
an httpOnly session cookie. `@pylo/nextjs` already implements that and remains
the recommendation for anyone with a server.

Cookies are not available to a standalone SPA. JavaScript cannot set an httpOnly
cookie, the Pylo API is a different origin so anything it set would be a
third-party cookie, and Pylo's login is a GraphQL mutation returning both tokens
in the response body with no cookie-setting endpoint to call.

So: localStorage on web, SecureStore on native. RFC 10017 permits the
JS-accessible tier while naming it the riskiest, and the mitigation it calls for
is refresh token rotation, which Pylo already does on every refresh. Docs state
plainly that a strong Content Security Policy is the real defense against XSS on
web. Native has no XSS surface and the OS keychain is genuinely secure.

### Transport

Approach A: the hook factory takes a transport of query, variables, and headers.

It is passed as a hook rather than a value. A single-page app's transport depends
on the session and therefore lives in React context, which a value supplied at
module scope could never reach. The default reads the provider's transport, so
`createPyloHooks<PyloSchema>()` takes no arguments.

`@pylo/nextjs` keeps its `apiPath` option and wraps it in a hook that ignores
context, so it still needs no provider and existing consumers see no change. `@pylo/react` builds its transport from the session's token getter
and the endpoint, running the same error mapping `executeGraphQL` already uses so
that hooks and the imperative client both throw `PyloError`.

Approach B, injecting the transport into `createPyloClient` so hooks call
`client.contact.list(...)` directly, was considered and rejected for this
release. It is the better end state and removes several hundred lines from the
hook file, but it rewrites the internals of fifteen hooks that currently have no
runtime tests.

### Core changes

Three, all prerequisites rather than follow-ups.

- Environment guard. Reading the endpoint from `process.env` at
  `core/src/client.ts:282` throws in a browser bundle where `process` is
  undefined. Needs a typeof check.
- React Native upload source. `toUploadPart` in `core/src/upload.ts` accepts
  File, Blob, and raw bytes. React Native has none of those for a local file and
  instead appends an object carrying a uri, a name, and a type directly to
  FormData, letting the platform stream it. New branch in the union, widened
  signature on `uploadToUrl`.
- Export conditions. `@pylo/core` and `@pylo/nextjs` declare only `types` and
  `import` with no fallback, while `@pylo/node` and `@pylo/auth-nextjs` declare
  a `default`. Adding the fallback makes all four consistent and removes the
  question of how Metro resolves that shape.

### Codegen

`@pylo/react` and `@pylo/expo` go into the registerable sources list in
`core/src/codegen/generate.ts:18`, and each ships the same `pylo generate` binary
pointed at its own augmentation target.

## Testing

The session logic is the only genuinely new logic here and the part most worth
testing: single-flight refresh, refresh-failure classification, and the boot
sequence. It lives in a framework-free session store, with `PyloProvider` as a
thin React binding over it. That store tests with the vitest setup already in the
repo, so the workspace needs neither React Testing Library nor a DOM
environment. It is also the better factoring on its own terms, since it is what
`@pylo/expo` will hang native sign-in off later.

The fifteen ported hooks keep their existing type tests in
`nextjs/test/hooks.test-d.ts`. Approach A barely moves their bodies, so there is
no retrofit harness in this project.

Packaging is checked two ways:

- Static. `publint` and `@arethetypeswrong/cli` against every package in CI.
  Seconds to run, and they catch the export-condition class outright.
- Fixtures. Four apps, each installing a packed tarball, importing the public
  surface, typechecking, and building: Vite React, Next.js, Expo, and Node. This
  also spreads across the module resolution modes that matter. The Expo fixture
  is the important one, being the only place Metro resolution and the React
  Native upload path are exercised. It also confirms that `decodeToken` can call
  `atob`, which React Native has provided globally for several versions but which
  is worth seeing pass rather than assuming.

## Release

One changeset set. `@pylo/react` and `@pylo/expo` start at 0.1.0. `@pylo/core`
takes a minor for the new upload source. `@pylo/nextjs` takes a patch, since its
public surface is unchanged and the fixtures are what prove that.

## Known debt

The hooks still call the query builders and unwrap the response envelope
themselves, duplicating what `createPyloClient` does internally. This is
duplicated call shape, not duplicated error handling. Approach B collapses it and
remains the intended end state once the hooks have runtime tests.
