import { describe, it, expectTypeOf } from "vitest";
import { usePyloAuth } from "../src/index.js";
import type { AuthResult } from "@pylo/auth";

describe("usePyloAuth social login without augmentation", () => {
  it("accepts the built-in providers and rejects others", () => {
    const { loginWith } = usePyloAuth();
    void loginWith("google", { returnUrl: "https://app/auth" });
    void loginWith("microsoft", { returnUrl: "https://app/auth" });
    // @ts-expect-error unknown provider
    void loginWith("github", { returnUrl: "https://app/auth" });
  });

  it("returns the sanitised redirect alongside the auth result", () => {
    const { completeLogin } = usePyloAuth();
    expectTypeOf(completeLogin).returns.resolves.toExtend<
      AuthResult & { redirect?: string }
    >();
  });
});
