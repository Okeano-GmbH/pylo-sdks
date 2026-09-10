import { useMemo } from "react";
import { PyloProvider as BaseProvider } from "@pylo/react";
import type { PyloProviderProps } from "@pylo/react";
import { createSecureStorage } from "./storage.js";

/** `@pylo/react`'s provider with the keychain wired up as the default store. */
export function PyloProvider(props: PyloProviderProps) {
  const storage = useMemo(
    () => props.storage ?? createSecureStorage(),
    [props.storage],
  );
  return <BaseProvider {...props} storage={storage} />;
}
