# @pylo/expo

Type-safe Pylo SDK for Expo and React Native. Everything
[`@pylo/react`](../react) provides, with the device keychain wired up as the
token store.

## Install

```bash
npx expo install @pylo/expo @tanstack/react-query expo-secure-store
```

## Set up

Import `PyloProvider` from this package and pass no storage: it defaults to
SecureStore.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PyloProvider } from "@pylo/expo";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PyloProvider appId={process.env.EXPO_PUBLIC_PYLO_APP_ID}>
        <Root />
      </PyloProvider>
    </QueryClientProvider>
  );
}
```

Generate your types with `npx pylo generate`, then use the hooks exactly as the
`@pylo/react` README describes. `usePyloAuth`, `createPyloHooks`,
`usePyloClient` and the rest are re-exported unchanged.

## Uploading files

React Native has no `File` for a local file. Pass the reference its pickers
return and the platform streams it from disk:

```tsx
const { startUpload } = usePyloUpload({ entityRelationPath: "contact.avatar" });

await startUpload({ uri: asset.uri, name: asset.fileName, type: asset.mimeType });
```

Such a reference carries no byte length, so progress across a batch weights each
file equally rather than by size.

## Refetching when the app returns to the foreground

TanStack Query watches browser events that React Native does not have, so
queries do not refetch when your app foregrounds. This package does not wire
that up for you. Add it once at your app's entry point:

```ts
import { AppState, type AppStateStatus } from "react-native";
import { focusManager } from "@tanstack/react-query";

AppState.addEventListener("change", (status: AppStateStatus) => {
  focusManager.setFocused(status === "active");
});
```

See the [TanStack Query React Native guide](https://tanstack.com/query/latest/docs/framework/react/react-native)
for the matching network-state setup.

## Token storage

SecureStore is backed by the OS keychain, so tokens are encrypted at rest and a
native app has no XSS surface to leak them through. Reads are asynchronous,
which is why `usePyloAuth` reports `isLoading` until the stored session has been
read.
