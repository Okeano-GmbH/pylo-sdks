import { describe, it, expect, vi } from "vitest";
import { subscribeAppStateToFocus } from "../src/app-state.js";

function fakes() {
  let listener: ((status: string) => void) | undefined;
  // `remove` drops the listener, so emitting after unsubscribe is a real no-op
  // rather than something the fake papers over.
  const remove = vi.fn(() => {
    listener = undefined;
  });
  const setFocused = vi.fn();

  const appState = {
    addEventListener: (_type: "change", fn: (status: string) => void) => {
      listener = fn;
      return { remove };
    },
  };

  return {
    appState,
    focusManager: { setFocused },
    remove,
    setFocused,
    emit: (status: string) => listener?.(status),
  };
}

describe("subscribeAppStateToFocus", () => {
  it("marks the app focused when it becomes active", () => {
    const f = fakes();
    subscribeAppStateToFocus(f.appState, f.focusManager);

    f.emit("active");

    expect(f.setFocused).toHaveBeenCalledWith(true);
  });

  it("marks it unfocused in the background and while inactive", () => {
    const f = fakes();
    subscribeAppStateToFocus(f.appState, f.focusManager);

    f.emit("background");
    f.emit("inactive");

    expect(f.setFocused).toHaveBeenNthCalledWith(1, false);
    expect(f.setFocused).toHaveBeenNthCalledWith(2, false);
  });

  it("restores the default on unsubscribe", () => {
    const f = fakes();
    const unsubscribe = subscribeAppStateToFocus(f.appState, f.focusManager);

    unsubscribe();

    expect(f.remove).toHaveBeenCalledTimes(1);
    // `undefined` hands focus tracking back to TanStack rather than pinning it.
    expect(f.setFocused).toHaveBeenCalledWith(undefined);
  });

  it("stops reacting after unsubscribe", () => {
    const f = fakes();
    const unsubscribe = subscribeAppStateToFocus(f.appState, f.focusManager);

    unsubscribe();
    f.setFocused.mockClear();
    f.emit("active");

    expect(f.setFocused).not.toHaveBeenCalled();
  });
});
