import { describe, it, expect } from "vitest";
import { shouldRefreshToken } from "../src/index.js";

const now = () => Math.floor(Date.now() / 1000);

const token = (payload: Record<string, unknown>) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

describe("shouldRefreshToken", () => {
  it("leaves a freshly minted token alone", () => {
    expect(shouldRefreshToken(token({ iat: now(), exp: now() + 3600 }))).toBe(false);
  });

  it("refreshes once the token is into the last quarter of its life", () => {
    expect(shouldRefreshToken(token({ iat: now() - 2800, exp: now() + 800 }))).toBe(true);
  });

  it("leaves it alone just short of that point", () => {
    expect(shouldRefreshToken(token({ iat: now() - 2600, exp: now() + 1000 }))).toBe(false);
  });

  // The reason the buffer is a share of the lifetime and not a fixed count of
  // seconds: a fixed buffer wide enough to ride out a deploy would mark every
  // short-lived token as expired the moment it was issued.
  it("scales the buffer down to a short-lived token rather than refreshing on every call", () => {
    expect(shouldRefreshToken(token({ iat: now(), exp: now() + 60 }))).toBe(false);
  });

  it("still refreshes a short-lived token near its end", () => {
    expect(shouldRefreshToken(token({ iat: now() - 50, exp: now() + 10 }))).toBe(true);
  });

  it("honours an explicit elapsed fraction", () => {
    const justPastHalf = token({ iat: now() - 1900, exp: now() + 1700 });

    expect(shouldRefreshToken(justPastHalf, { elapsedFraction: 0.5 })).toBe(true);
    expect(shouldRefreshToken(justPastHalf, { elapsedFraction: 0.9 })).toBe(false);
  });

  describe("without an iat claim", () => {
    it("falls back to the fixed floor instead of a scaled buffer", () => {
      expect(shouldRefreshToken(token({ exp: now() + 3600 }))).toBe(false);
    });

    it("refreshes inside that floor", () => {
      expect(shouldRefreshToken(token({ exp: now() + 5 }))).toBe(true);
    });
  });

  it("refreshes an already expired token", () => {
    expect(shouldRefreshToken(token({ iat: now() - 7200, exp: now() - 3600 }))).toBe(true);
  });

  it("refreshes a token it cannot decode", () => {
    expect(shouldRefreshToken("not-a-jwt")).toBe(true);
  });

  it("leaves a token with no exp claim alone", () => {
    expect(shouldRefreshToken(token({ iat: now() }))).toBe(false);
  });
});
