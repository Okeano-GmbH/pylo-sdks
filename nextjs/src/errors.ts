/**
 * Whether a hook or transport error means the session is gone, so the app
 * should send the user to login. Checks the status rather than `instanceof`,
 * which fails when two copies of `@pylo/core` are installed.
 */
export function isPyloUnauthorized(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { httpStatus?: unknown }).httpStatus === 401
  );
}
