import { describe, it, expectTypeOf } from "vitest";
import { usePyloAuth } from "../src/index.js";
import type { AuthResult } from "@pylo/auth";

describe("usePyloAuth social sign-in without augmentation", () => {
  it("accepts the built-in providers and rejects others", () => {
    const { signInWith } = usePyloAuth();
    void signInWith("google", { returnUrl: "https://app/auth" });
    void signInWith("microsoft", { returnUrl: "https://app/auth" });
    // @ts-expect-error unknown provider
    void signInWith("github", { returnUrl: "https://app/auth" });
  });

  it("returns the sanitised redirect alongside the auth result", () => {
    const { completeSignIn } = usePyloAuth();
    expectTypeOf(completeSignIn).returns.resolves.toMatchTypeOf<
      AuthResult & { redirect?: string }
    >();
  });
});
