import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { focusManager } from "@tanstack/react-query";
import { PyloProvider as BaseProvider } from "@pylo/react";
import type { PyloProviderProps as BaseProps } from "@pylo/react";
import { createSecureStorage } from "./storage.js";
import { subscribeAppStateToFocus } from "./app-state.js";

export interface PyloProviderProps extends BaseProps {
  /**
   * Refetch stale queries when the app returns to the foreground. On by
   * default, because TanStack Query's own focus tracking relies on a browser
   * event React Native does not have. The focus manager is global, so this
   * covers every query in the app. Turn it off if you wire it up yourself.
   */
  refetchOnAppFocus?: boolean;
}

/** `@pylo/react`'s provider with the keychain and app focus wired up. */
export function PyloProvider({ refetchOnAppFocus = true, ...props }: PyloProviderProps) {
  const storage = useMemo(
    () => props.storage ?? createSecureStorage(),
    [props.storage],
  );

  useEffect(() => {
    if (!refetchOnAppFocus) return;
    return subscribeAppStateToFocus(AppState, focusManager);
  }, [refetchOnAppFocus]);

  return <BaseProvider {...props} storage={storage} />;
}
