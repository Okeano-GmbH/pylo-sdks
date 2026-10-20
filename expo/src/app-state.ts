interface AppStateSubscription {
  remove(): void;
}

interface AppStateLike {
  addEventListener(
    type: "change",
    listener: (status: string) => void,
  ): AppStateSubscription;
}

interface FocusManagerLike {
  setFocused(focused?: boolean): void;
}

/**
 * TanStack Query decides focus from a browser visibility event React Native
 * does not have, so queries never refetch when the app returns to the
 * foreground. The focus manager is global, so this affects every query in the
 * app rather than only Pylo's.
 *
 * Returns an unsubscribe that also restores the default focus behaviour.
 */
export function subscribeAppStateToFocus(
  appState: AppStateLike,
  focusManager: FocusManagerLike,
): () => void {
  const subscription = appState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active");
  });

  return () => {
    subscription.remove();
    focusManager.setFocused(undefined);
  };
}

interface WakeableLike {
  wake(): void;
}

/**
 * React Native has no focus or `online` event, so the realtime connection is
 * checked when the app returns to the foreground: a socket that died in the
 * background is replaced right away instead of after the next heartbeat.
 */
export function subscribeAppStateToRealtime(
  appState: AppStateLike,
  realtime: WakeableLike,
): () => void {
  const subscription = appState.addEventListener("change", (status) => {
    if (status === "active") realtime.wake();
  });
  return () => subscription.remove();
}
