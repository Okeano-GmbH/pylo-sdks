# @pylo/react

Type-safe Pylo SDK for React single-page apps. Hooks, a session provider, and a
typed client, generated from your own Pylo schema.

For Next.js use [`@pylo/nextjs`](../nextjs), which keeps tokens in httpOnly
cookies. For Expo and React Native use [`@pylo/expo`](../expo).

## Install

```bash
npm install @pylo/react @tanstack/react-query
```

## Generate types

Add a `pylo.config.ts` at your project root, then run the generator. It writes
`.pylo/index.ts` and registers the schema, so no `declare module` is needed.

```bash
npx pylo generate
```

## Set up

Your app owns the QueryClient. `PyloProvider` goes inside it, because signing
out clears the query cache.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PyloProvider } from "@pylo/react";

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PyloProvider appId={import.meta.env.VITE_PYLO_APP_ID}>
        <Routes />
      </PyloProvider>
    </QueryClientProvider>
  );
}
```

## Sign in

```tsx
import { usePyloAuth } from "@pylo/react";

function SignIn() {
  const { isLoading, isSignedIn, user, login, logout } = usePyloAuth();

  if (isLoading) return <Spinner />;
  if (isSignedIn) return <button onClick={() => logout()}>Sign out {user?.email}</button>;

  return <button onClick={() => login(email, password)}>Sign in</button>;
}
```

`isLoading` stays true until stored tokens have been read, so an already
signed-in user never sees a login screen flash.

## Query data

```tsx
import { createPyloHooks } from "@pylo/react";
import type { PyloSchema } from "@pylo/types";

const { usePyloList, usePyloUpsert } = createPyloHooks<PyloSchema>();

function Contacts() {
  const { data, isLoading } = usePyloList("contact", {
    select: { id: true, name: true, company: { select: { name: true } } },
  });

  const upsert = usePyloUpsert("contact");

  return <List rows={data} onRename={(id, name) => upsert.mutate({ id, name })} />;
}
```

For imperative calls outside a query, `usePyloClient<PyloSchema>()` returns the
same typed client the server SDK exposes.

## Token storage

Tokens live in `localStorage`, which any script running on your page can read.
Refresh tokens rotate on every use, but a strong Content Security Policy is what
actually protects them. If your app has a backend, keep the tokens there and
proxy requests through it instead.

The token is refreshed before it expires and once more if a request comes back
unauthorized. Only a rejected refresh token ends the session: a transient server
error leaves it intact, so a backend deploy does not sign everyone out.

## Bringing your own auth

Pass `getToken` instead, and the provider skips login, logout and refresh
entirely.

```tsx
<PyloProvider getToken={() => auth.getAccessToken()}>
```

## Custom storage

`PyloProvider` takes any `PyloStorage`: three async methods for get, set and
remove.

```ts
import type { PyloStorage } from "@pylo/react";
```
