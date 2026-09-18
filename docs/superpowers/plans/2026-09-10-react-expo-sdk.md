# React and Expo SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@pylo/react` and `@pylo/expo`, and move `@pylo/nextjs` onto the same hook factory through an injected transport.

**Architecture:** `@pylo/react` holds the hook factory, a framework-free session store, a direct GraphQL transport, and a localStorage adapter. `@pylo/expo` re-exports it with SecureStore preconfigured. `@pylo/nextjs` keeps its public surface and supplies a transport that posts to its existing route handler. All three sit on the unchanged `@pylo/core` client and `@pylo/auth` primitives.

**Tech Stack:** TypeScript 5.9 strict, ESM only, tsup, vitest, React 18+, TanStack Query 5, pnpm workspaces, changesets.

**Spec:** `docs/superpowers/specs/2026-09-10-react-expo-sdk-design.md`

## Global Constraints

- Every package is ESM only: `"type": "module"`, `"format": ["esm"]` in tsup.
- `verbatimModuleSyntax: true`. Type-only imports MUST use `import type`.
- `exactOptionalPropertyTypes: true`. Never pass `{ key: undefined }` where the property is optional; spread conditionally: `...(x !== undefined ? { x } : {})`.
- `noUncheckedIndexedAccess: true`. Index access yields `T | undefined`.
- Peer dependency floors: `react >=18.0.0`, `@tanstack/react-query >=5.0.0`, `expo-secure-store >=12.0.0`.
- Every package's `exports` entries MUST declare `types`, `import`, and `default`.
- Runtime tests live at `<package>/test/*.test.ts`. Type tests live at `<package>/test/*.test-d.ts`.
- Run tests from the repo root with `pnpm test`. Build with `pnpm -r build`.
- Comments are rare and short, and explain why rather than what. Match the surrounding files.
- Commit messages end with the two attribution lines used in this repo's recent commits.

---

### Task 1: Guard `process.env` in the core client

**Files:**
- Modify: `core/src/client.ts:280-283`
- Test: `core/test/client-endpoint.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `getEndpoint` keeps its signature `(endpoint?: string) => string` and no longer throws when `process` is undefined.

- [ ] **Step 1: Write the failing test**

```ts
// core/test/client-endpoint.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_GRAPHQL_ENDPOINT } from "@pylo/auth";

const { resolveEndpoint } = await import("../src/client.js");

const original = globalThis.process;

afterEach(() => {
  globalThis.process = original;
});

describe("resolveEndpoint", () => {
  it("returns the explicit endpoint when given one", () => {
    expect(resolveEndpoint("https://api.test/graphql")).toBe("https://api.test/graphql");
  });

  it("falls back to the default when process is undefined", () => {
    // A browser bundle has no `process`; reading it must not throw.
    // @ts-expect-error deleting a global for the duration of this test
    delete globalThis.process;
    expect(resolveEndpoint()).toBe(DEFAULT_GRAPHQL_ENDPOINT);
  });

  it("reads PYLO_GRAPHQL_ENDPOINT when process exists", () => {
    globalThis.process = {
      ...original,
      env: { ...original.env, PYLO_GRAPHQL_ENDPOINT: "https://env.test/graphql" },
    } as typeof original;
    expect(resolveEndpoint()).toBe("https://env.test/graphql");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run core/test/client-endpoint.test.ts`
Expected: FAIL, `resolveEndpoint is not a function`.

- [ ] **Step 3: Rename and guard the function**

In `core/src/client.ts`, replace the existing `getEndpoint`:

```ts
export function resolveEndpoint(endpoint?: string): string {
  if (endpoint) return endpoint;
  // Browser and React Native bundles have no `process`, so reading it directly
  // throws a ReferenceError rather than yielding undefined.
  const fromEnv =
    typeof process !== "undefined"
      ? process.env["PYLO_GRAPHQL_ENDPOINT"]
      : undefined;
  return fromEnv ?? DEFAULT_GRAPHQL_ENDPOINT;
}
```

Update the single call site inside `createPyloClient` from `getEndpoint(` to `resolveEndpoint(`.

- [ ] **Step 4: Export it**

In `core/src/index.ts`, add `resolveEndpoint` to the existing `export { ... } from "./client.js";` block.

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: PASS, including the three new cases.

- [ ] **Step 6: Commit**

```bash
git add core/src/client.ts core/src/index.ts core/test/client-endpoint.test.ts
git commit -m "fix(core): read PYLO_GRAPHQL_ENDPOINT without assuming process exists"
```

---

### Task 2: Accept a React Native file reference as an upload source

**Files:**
- Modify: `core/src/upload.ts` (the `UploadSource` type, `toUploadPart`, `uploadToUrl`)
- Modify: `core/src/index.ts` (export the new type)
- Test: `core/test/upload.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveEndpoint` from Task 1 is unrelated; nothing consumed.
- Produces:
  - `interface UploadFileRef { uri: string; name: string; type?: string }`
  - `type UploadSource = File | Blob | ArrayBuffer | ArrayBufferView | UploadFileRef`
  - `type UploadPart = Blob | UploadFileRef`
  - `toUploadPart(source, options?) => { part: UploadPart; fileName: string; mimeType: string | undefined; size: number | undefined }`
  - `uploadToUrl(url: string, part: UploadPart, fileName: string, options?) => Promise<void>`

React Native has no `File` for a local file. Its `FormData` accepts an object carrying a uri, a name and a type, and the platform streams the file from disk. Such a reference has no known byte length, so `size` is `undefined` and progress falls back to the transfer's own totals.

- [ ] **Step 1: Write the failing tests**

Append to `core/test/upload.test.ts`:

```ts
describe("toUploadPart with a React Native file reference", () => {
  it("passes the reference through and reports an unknown size", () => {
    const source = { uri: "file:///tmp/a.png", name: "a.png", type: "image/png" };
    const result = toUploadPart(source);
    expect(result.part).toBe(source);
    expect(result.fileName).toBe("a.png");
    expect(result.mimeType).toBe("image/png");
    expect(result.size).toBeUndefined();
  });

  it("lets explicit options override the reference's own name and type", () => {
    const source = { uri: "file:///tmp/a.png", name: "a.png", type: "image/png" };
    const result = toUploadPart(source, { fileName: "b.png", mimeType: "image/webp" });
    expect(result.fileName).toBe("b.png");
    expect(result.mimeType).toBe("image/webp");
  });

  it("still rejects an object that is not a recognised source", () => {
    expect(() => toUploadPart({ nope: true } as never, { fileName: "x" })).toThrow(
      /Unsupported upload source/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run core/test/upload.test.ts`
Expected: FAIL, `toUploadPart` throws "Unsupported upload source" for the reference.

- [ ] **Step 3: Add the type and the branch**

In `core/src/upload.ts`, replace the `UploadSource` type:

```ts
/**
 * A local file as React Native describes one. Its `FormData` streams the file
 * from disk, so the SDK never reads the bytes and the length is unknown.
 */
export interface UploadFileRef {
  uri: string;
  name: string;
  type?: string;
}

export type UploadSource = File | Blob | ArrayBuffer | ArrayBufferView | UploadFileRef;

/** What actually gets appended to a `FormData`. */
export type UploadPart = Blob | UploadFileRef;

export function isUploadFileRef(source: unknown): source is UploadFileRef {
  return (
    typeof source === "object" &&
    source !== null &&
    typeof (source as UploadFileRef).uri === "string" &&
    typeof (source as UploadFileRef).name === "string"
  );
}
```

Change `toUploadPart`'s return type to `{ part: UploadPart; fileName: string; mimeType: string | undefined; size: number | undefined }`, rename each existing `blob:` property in its return statements to `part:` and add `size: blob.size` to each. Then insert this branch immediately before the raw-bytes fallback (after the `Blob` branch):

```ts
  if (isUploadFileRef(source)) {
    const fileName = options?.fileName ?? source.name;
    const mimeType = options?.mimeType ?? source.type;
    const part =
      fileName === source.name && mimeType === source.type
        ? source
        : { uri: source.uri, name: fileName, ...(mimeType !== undefined ? { type: mimeType } : {}) };
    return { part, fileName, mimeType, size: undefined };
  }
```

- [ ] **Step 4: Widen `uploadToUrl`**

Change its signature to `(url: string, part: UploadPart, fileName: string, options?)`. Replace the FormData construction and the `total` calculation:

```ts
  const form = new FormData();
  if (part instanceof Blob) {
    form.append("file", part, fileName);
  } else {
    // React Native's FormData takes the reference itself and streams the file.
    form.append("file", part as unknown as Blob, fileName);
  }

  const total = part instanceof Blob ? part.size : undefined;
  const report = (loaded: number, knownTotal = total) => {
    options?.onProgress?.({
      loaded,
      total: knownTotal ?? loaded,
      percent:
        knownTotal !== undefined && knownTotal > 0
          ? Math.round((loaded / knownTotal) * 100)
          : 100,
    });
  };
```

In the XHR progress handler, keep the blob-relative mapping only when the size is known:

```ts
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total === 0) return;
        if (total === undefined) {
          // No file size to map onto — report the wire totals as they are.
          report(event.loaded, event.total);
          return;
        }
        const ratio = Math.min(event.loaded / event.total, 1);
        report(Math.round(ratio * total));
      };
```

Replace the two bare `report(total)` calls with `report(total ?? 0)` and the `report(0)` fetch-path call stays as is.

- [ ] **Step 5: Fix the call sites in the core files client**

In `core/src/client.ts`, the `files.upload` implementation destructures `{ blob, fileName, mimeType }` from `toUploadPart` and passes `blob` to `uploadToUrl`, then reports `size: blob.size`. Change it to destructure `{ part, fileName, mimeType, size }`, pass `part`, and report `size: size ?? 0`.

- [ ] **Step 6: Export the new types**

In `core/src/index.ts`, add `UploadFileRef`, `UploadPart` to the `export type { ... } from "./upload.js";` block and `isUploadFileRef` to the value export block.

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add core/src/upload.ts core/src/client.ts core/src/index.ts core/test/upload.test.ts
git commit -m "feat(core): accept a React Native file reference as an upload source"
```

---

### Task 3: Make export conditions consistent and check them in CI

**Files:**
- Modify: `core/package.json`, `nextjs/package.json` (add `default` to every exports entry)
- Modify: `package.json` (root, add the check script and dev dependencies)

**Interfaces:**
- Produces: a root script `pnpm check:packaging` that runs `publint` and `attw` over every built package.

- [ ] **Step 1: Add the fallback condition**

In `core/package.json`, every entry under `exports` that is an object gains `"default"` pointing at the same file as `"import"`. The `"./cli"` string entry stays as it is. Do the same for all five entries in `nextjs/package.json`. Example:

```json
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
```

- [ ] **Step 2: Add the tooling**

```bash
pnpm add -Dw publint @arethetypeswrong/cli
```

- [ ] **Step 3: Add the script**

In the root `package.json` scripts block:

```json
    "check:packaging": "pnpm -r --filter=./auth --filter=./auth-nextjs --filter=./core --filter=./node --filter=./nextjs exec publint && pnpm -r --filter=./auth --filter=./auth-nextjs --filter=./core --filter=./node --filter=./nextjs exec attw --pack --profile esm-only",
```

- [ ] **Step 4: Run it**

Run: `pnpm -r build && pnpm check:packaging`
Expected: PASS for all five packages. If `attw` reports a genuine problem beyond the condition fallback, fix the package rather than suppressing the rule.

- [ ] **Step 5: Commit**

```bash
git add package.json core/package.json nextjs/package.json pnpm-lock.yaml
git commit -m "build: declare a default export condition and check packaging in CI"
```

---

### Task 4: Register the two new module names with codegen

**Files:**
- Modify: `core/src/codegen/generate.ts:18`
- Test: `core/test/generate.test.ts` (extend)

**Interfaces:**
- Produces: `generateIndexFile(entities, "@pylo/react")` and `generateIndexFile(entities, "@pylo/expo")` emit a `declare module` block registering `PyloSchema`.

- [ ] **Step 1: Write the failing test**

Append to `core/test/generate.test.ts`:

```ts
describe("PyloRegister augmentation", () => {
  it.each(["@pylo/node", "@pylo/nextjs", "@pylo/react", "@pylo/expo"])(
    "registers the schema for %s",
    (source) => {
      const output = generateIndexFile([], source);
      expect(output).toContain(`declare module '${source}'`);
      expect(output).toContain("schema: PyloSchema;");
    },
  );

  it("does not register for @pylo/core, which has no PyloRegister", () => {
    expect(generateIndexFile([], "@pylo/core")).not.toContain("declare module");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run core/test/generate.test.ts`
Expected: FAIL for `@pylo/react` and `@pylo/expo`.

- [ ] **Step 3: Add the names**

```ts
const REGISTERABLE_SOURCES = new Set([
  "@pylo/node",
  "@pylo/nextjs",
  "@pylo/react",
  "@pylo/expo",
]);
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/codegen/generate.ts core/test/generate.test.ts
git commit -m "feat(core): register @pylo/react and @pylo/expo as codegen targets"
```

---

### Task 5: Scaffold the `@pylo/react` package

**Files:**
- Create: `react/package.json`, `react/tsconfig.json`, `react/tsup.config.ts`, `react/LICENSE`, `react/src/index.ts`
- Modify: `pnpm-workspace.yaml`, `tsconfig.test.json`

**Interfaces:**
- Produces: a buildable `@pylo/react` whose `.` entry re-exports the same type surface `@pylo/nextjs` does today, plus its own `PyloRegister`, `PyloEntity`, `PyloSelect`, `PyloResult`.

- [ ] **Step 1: Add the package to the workspace**

In `pnpm-workspace.yaml`, add `- "react"` and `- "expo"` to the `packages` list.

- [ ] **Step 2: Create `react/package.json`**

```json
{
  "name": "@pylo/react",
  "version": "0.0.0",
  "description": "Type-safe React SDK for Pylo — hooks, session provider, client",
  "type": "module",
  "bin": { "pylo": "dist/cli.js" },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" },
    "./codegen": { "types": "./dist/codegen.d.ts", "import": "./dist/codegen.js", "default": "./dist/codegen.js" }
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "watch": "tsc -w",
    "prepublishOnly": "pnpm run build"
  },
  "dependencies": {
    "@pylo/auth": "workspace:*",
    "@pylo/core": "workspace:*"
  },
  "peerDependencies": {
    "@tanstack/react-query": ">=5.0.0",
    "react": ">=18.0.0"
  },
  "devDependencies": {
    "@tanstack/react-query": "^5.0.0",
    "@types/node": "^22.15.21",
    "@types/react": "^19.0.0",
    "react": "^19.0.0",
    "tsup": "^8.5.1",
    "typescript": "^5.9.3"
  },
  "keywords": ["pylo", "react", "sdk"],
  "author": "Okeano GmbH",
  "license": "MIT",
  "homepage": "https://github.com/Okeano-GmbH/pylo-sdks/tree/main/react#readme",
  "repository": { "type": "git", "url": "git+https://github.com/Okeano-GmbH/pylo-sdks.git", "directory": "react" },
  "bugs": { "url": "https://github.com/Okeano-GmbH/pylo-sdks/issues" },
  "packageManager": "pnpm@10.12.1"
}
```

- [ ] **Step 3: Copy the configs**

`react/tsconfig.json` is `nextjs/tsconfig.json` verbatim, including `"jsx": "react-jsx"`.
`react/LICENSE` is a copy of `nextjs/LICENSE`.
`react/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/codegen.ts"],
    format: ["esm"],
    outDir: "dist",
    dts: true,
    splitting: false,
    external: ["react", "react/jsx-runtime", "@tanstack/react-query"],
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
    dts: false,
    splitting: false,
  },
]);
```

- [ ] **Step 4: Create the public type surface**

`react/src/index.ts` is `nextjs/src/index.ts` copied verbatim, with the doc comment's `declare module "@pylo/nextjs"` example changed to `@pylo/react` and the `usePyloList` example left as it is. It defines its own `PyloRegister`, `RegisteredSchema`, `PyloEntity`, `PyloSelect`, `PyloResult`.

- [ ] **Step 5: Create the codegen and CLI entries**

`react/src/codegen.ts` is `nextjs/src/codegen.ts` verbatim.
`react/src/cli.ts` is `nextjs/src/cli.ts` with `importSource: "@pylo/react"`.

- [ ] **Step 6: Add the test path alias**

In `tsconfig.test.json`, add `"@pylo/react": ["./react/src/index.ts"]` to `paths`.

- [ ] **Step 7: Build**

Run: `pnpm install && pnpm -r build`
Expected: `@pylo/react` builds and emits `dist/index.js`, `dist/index.d.ts`, `dist/codegen.js`, `dist/cli.js`.

- [ ] **Step 8: Commit**

```bash
git add react pnpm-workspace.yaml tsconfig.test.json pnpm-lock.yaml
git commit -m "feat(react): scaffold @pylo/react with its type surface and CLI"
```

---

### Task 6: Storage adapters

**Files:**
- Create: `react/src/session/storage.ts`
- Test: `react/test/storage.test.ts`

**Interfaces:**
- Produces:
  - `interface PyloStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }`
  - `createLocalStorageAdapter(): PyloStorage`
  - `createMemoryStorage(): PyloStorage`

- [ ] **Step 1: Write the failing test**

```ts
// react/test/storage.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createLocalStorageAdapter, createMemoryStorage } from "../src/session/storage.js";

describe("createMemoryStorage", () => {
  it("round-trips and removes values", async () => {
    const storage = createMemoryStorage();
    expect(await storage.getItem("a")).toBeNull();
    await storage.setItem("a", "1");
    expect(await storage.getItem("a")).toBe("1");
    await storage.removeItem("a");
    expect(await storage.getItem("a")).toBeNull();
  });
});

describe("createLocalStorageAdapter", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>)["localStorage"] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it("round-trips through localStorage", async () => {
    const storage = createLocalStorageAdapter();
    await storage.setItem("a", "1");
    expect(await storage.getItem("a")).toBe("1");
    await storage.removeItem("a");
    expect(await storage.getItem("a")).toBeNull();
  });

  it("degrades to memory when localStorage is unavailable", async () => {
    delete (globalThis as Record<string, unknown>)["localStorage"];
    const storage = createLocalStorageAdapter();
    await storage.setItem("a", "1");
    expect(await storage.getItem("a")).toBe("1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run react/test/storage.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// react/src/session/storage.ts

/**
 * The three operations a session needs from a key-value store. Async because
 * the native implementations are: Expo's SecureStore has no sync API.
 */
export interface PyloStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createMemoryStorage(): PyloStorage {
  const store = new Map<string, string>();
  return {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => void store.set(key, value),
    removeItem: async (key) => void store.delete(key),
  };
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Persists to `localStorage`, falling back to memory where it is missing or
 * blocked — server rendering, and Safari's private mode, which throws on write.
 * A memory fallback means the session lasts the page's lifetime instead of
 * failing outright.
 */
export function createLocalStorageAdapter(): PyloStorage {
  const web = (globalThis as { localStorage?: WebStorageLike }).localStorage;
  if (!web) return createMemoryStorage();

  const fallback = createMemoryStorage();
  return {
    getItem: async (key) => {
      try {
        return web.getItem(key);
      } catch {
        return fallback.getItem(key);
      }
    },
    setItem: async (key, value) => {
      try {
        web.setItem(key, value);
      } catch {
        await fallback.setItem(key, value);
      }
    },
    removeItem: async (key) => {
      try {
        web.removeItem(key);
      } catch {
        await fallback.removeItem(key);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run react/test/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add react/src/session/storage.ts react/test/storage.test.ts
git commit -m "feat(react): add the storage interface with localStorage and memory adapters"
```

---

### Task 7: The session store

**Files:**
- Create: `react/src/session/store.ts`
- Test: `react/test/session-store.test.ts`

**Interfaces:**
- Consumes: `PyloStorage` from Task 6.
- Produces:
  - `type SessionStatus = "loading" | "signedIn" | "signedOut"`
  - `interface SessionState { status: SessionStatus; token: string | null }`
  - `interface SessionStoreOptions { endpoint: string; storage: PyloStorage; appId?: string; keyPrefix?: string; onSignOut?: () => void }`
  - `interface SessionStore { getState(): SessionState; subscribe(l: () => void): () => void; init(): Promise<void>; getToken(): Promise<string | null>; refresh(): Promise<string | null>; login(email: string, password: string): Promise<AuthResult>; logout(): Promise<void> }`
  - `createSessionStore(options: SessionStoreOptions): SessionStore`

This is the only genuinely new logic in the project. It is framework-free so it tests without a DOM.

- [ ] **Step 1: Write the failing tests**

```ts
// react/test/session-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createSessionStore } = await import("../src/session/store.js");
const { createMemoryStorage } = await import("../src/session/storage.js");

// exp far in the future, iat now — `shouldRefreshToken` leaves this alone.
const fresh = (): string => {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({ sub: "u1", iat: now, exp: now + 3600 });
};

// 90% of its lifetime elapsed — past the default 0.75 threshold.
const stale = (): string => {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({ sub: "u1", iat: now - 900, exp: now + 100 });
};

function makeToken(payload: Record<string, unknown>): string {
  const b64 = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

const options = () => ({
  endpoint: "https://api.test/graphql",
  storage: createMemoryStorage(),
});

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("init", () => {
  it("starts loading and settles signed out with no stored token", async () => {
    const store = createSessionStore(options());
    expect(store.getState().status).toBe("loading");
    await store.init();
    expect(store.getState()).toEqual({ status: "signedOut", token: null });
  });

  it("settles signed in when storage holds a fresh token", async () => {
    const storage = createMemoryStorage();
    const token = fresh();
    await storage.setItem("pylo.auth_token", token);
    await storage.setItem("pylo.refresh_token", "r1");

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    expect(store.getState()).toEqual({ status: "signedIn", token });
  });
});

describe("login", () => {
  it("stores both tokens and signs in", async () => {
    const token = fresh();
    graphqlRequest.mockResolvedValue({
      data: { login: { data: { auth_token: token, refresh_token: "r1" } } },
    });

    const storage = createMemoryStorage();
    const store = createSessionStore({ ...options(), storage });
    await store.init();

    const result = await store.login("a@b.c", "pw");

    expect(result.success).toBe(true);
    expect(store.getState()).toEqual({ status: "signedIn", token });
    expect(await storage.getItem("pylo.refresh_token")).toBe("r1");
  });

  it("reports failure without signing in", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "Bad credentials", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const store = createSessionStore(options());
    await store.init();
    const result = await store.login("a@b.c", "wrong");

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_CREDENTIALS");
    expect(store.getState().status).toBe("signedOut");
  });

  it("sends the app id when one is configured", async () => {
    graphqlRequest.mockResolvedValue({
      data: { login: { data: { auth_token: fresh(), refresh_token: "r1" } } },
    });

    const store = createSessionStore({ ...options(), appId: "app-1" });
    await store.init();
    await store.login("a@b.c", "pw");

    expect(graphqlRequest.mock.calls[0]?.[2]).toEqual({
      input: { email: "a@b.c", password: "pw", pylo_app_id: "app-1" },
    });
  });
});

describe("getToken", () => {
  it("refreshes a token that is past its threshold", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", stale());
    await storage.setItem("pylo.refresh_token", "r1");

    const rotated = fresh();
    graphqlRequest.mockResolvedValue({
      data: { refreshToken: { data: { auth_token: rotated, refresh_token: "r2" } } },
    });

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    expect(await store.getToken()).toBe(rotated);
    expect(await storage.getItem("pylo.refresh_token")).toBe("r2");
  });

  it("issues one refresh for concurrent callers", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", stale());
    await storage.setItem("pylo.refresh_token", "r1");

    graphqlRequest.mockResolvedValue({
      data: { refreshToken: { data: { auth_token: fresh(), refresh_token: "r2" } } },
    });

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    await Promise.all([store.getToken(), store.getToken(), store.getToken()]);

    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });

  it("leaves a fresh token alone", async () => {
    const storage = createMemoryStorage();
    const token = fresh();
    await storage.setItem("pylo.auth_token", token);
    await storage.setItem("pylo.refresh_token", "r1");

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    expect(await store.getToken()).toBe(token);
    expect(graphqlRequest).not.toHaveBeenCalled();
  });
});

describe("refresh failure", () => {
  it("signs out when the refresh token itself is rejected", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", stale());
    await storage.setItem("pylo.refresh_token", "r1");
    const onSignOut = vi.fn();

    graphqlRequest.mockResolvedValue({
      errors: [{ message: "Invalid token", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const store = createSessionStore({ ...options(), storage, onSignOut });
    await store.init();
    await store.getToken();

    expect(store.getState()).toEqual({ status: "signedOut", token: null });
    expect(await storage.getItem("pylo.refresh_token")).toBeNull();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("keeps the session on a transient server error", async () => {
    const storage = createMemoryStorage();
    const token = stale();
    await storage.setItem("pylo.auth_token", token);
    await storage.setItem("pylo.refresh_token", "r1");
    const onSignOut = vi.fn();

    graphqlRequest.mockResolvedValue({
      errors: [{ message: "boom", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
    });

    const store = createSessionStore({ ...options(), storage, onSignOut });
    await store.init();
    await store.getToken();

    expect(store.getState().status).toBe("signedIn");
    expect(await storage.getItem("pylo.refresh_token")).toBe("r1");
    expect(onSignOut).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("clears storage and state", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", fresh());
    await storage.setItem("pylo.refresh_token", "r1");
    const onSignOut = vi.fn();

    const store = createSessionStore({ ...options(), storage, onSignOut });
    await store.init();
    await store.logout();

    expect(store.getState()).toEqual({ status: "signedOut", token: null });
    expect(await storage.getItem("pylo.auth_token")).toBeNull();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe", () => {
  it("notifies on every state change and stops after unsubscribe", async () => {
    const listener = vi.fn();
    const store = createSessionStore(options());
    const unsubscribe = store.subscribe(listener);

    await store.init();
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    const before = listener.mock.calls.length;
    await store.logout();
    expect(listener.mock.calls.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run react/test/session-store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// react/src/session/store.ts
import {
  graphqlRequest,
  hasErrors,
  extractErrorMessage,
  isUnauthorizedError,
  shouldRefreshToken,
  LOGIN_MUTATION,
  REFRESH_TOKEN_MUTATION,
} from "@pylo/auth";
import type { AuthResult, LoginResponse, RefreshTokenResponse } from "@pylo/auth";
import type { PyloStorage } from "./storage.js";

export type SessionStatus = "loading" | "signedIn" | "signedOut";

export interface SessionState {
  status: SessionStatus;
  token: string | null;
}

export interface SessionStoreOptions {
  endpoint: string;
  storage: PyloStorage;
  appId?: string;
  /** Namespaces the storage keys, for apps holding more than one session. */
  keyPrefix?: string;
  onSignOut?: () => void;
}

export interface SessionStore {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  init(): Promise<void>;
  /** The token to send, refreshed first if it is close enough to expiry. */
  getToken(): Promise<string | null>;
  /** Forces a refresh regardless of expiry. Used after a rejected request. */
  refresh(): Promise<string | null>;
  login(email: string, password: string): Promise<AuthResult>;
  logout(): Promise<void>;
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const prefix = options.keyPrefix ?? "pylo";
  const AUTH_KEY = `${prefix}.auth_token`;
  const REFRESH_KEY = `${prefix}.refresh_token`;

  let state: SessionState = { status: "loading", token: null };
  let refreshToken: string | null = null;
  let inFlight: Promise<string | null> | null = null;
  const listeners = new Set<() => void>();

  function setState(next: SessionState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  async function persist(auth: string, refresh: string): Promise<void> {
    refreshToken = refresh;
    await options.storage.setItem(AUTH_KEY, auth);
    await options.storage.setItem(REFRESH_KEY, refresh);
    setState({ status: "signedIn", token: auth });
  }

  async function clear(): Promise<void> {
    refreshToken = null;
    await options.storage.removeItem(AUTH_KEY);
    await options.storage.removeItem(REFRESH_KEY);
    setState({ status: "signedOut", token: null });
    options.onSignOut?.();
  }

  async function runRefresh(): Promise<string | null> {
    if (!refreshToken) {
      await clear();
      return null;
    }

    const response = await graphqlRequest<RefreshTokenResponse>(
      options.endpoint,
      REFRESH_TOKEN_MUTATION,
      { input: { refresh_token: refreshToken } },
    );

    if (hasErrors(response) || !response.data) {
      // Only a rejected refresh token ends the session. A transient failure
      // must leave it intact, or a backend deploy signs out every client at
      // once and the next request would have succeeded.
      if (isUnauthorizedError(response)) {
        await clear();
        return null;
      }
      return state.token;
    }

    const { auth_token, refresh_token } = response.data.refreshToken.data;
    await persist(auth_token, refresh_token);
    return auth_token;
  }

  function refresh(): Promise<string | null> {
    // Single-flight: many hooks mounting together must produce one refresh,
    // and a rotated refresh token makes a second concurrent call fail anyway.
    inFlight ??= runRefresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async init() {
      const [auth, refresh] = await Promise.all([
        options.storage.getItem(AUTH_KEY),
        options.storage.getItem(REFRESH_KEY),
      ]);
      refreshToken = refresh;
      setState(
        auth ? { status: "signedIn", token: auth } : { status: "signedOut", token: null },
      );
    },

    async getToken() {
      if (!state.token) return null;
      if (shouldRefreshToken(state.token)) return refresh();
      return state.token;
    },

    refresh,

    async login(email, password) {
      const response = await graphqlRequest<LoginResponse>(
        options.endpoint,
        LOGIN_MUTATION,
        {
          input: {
            email,
            password,
            ...(options.appId !== undefined ? { pylo_app_id: options.appId } : {}),
          },
        },
      );

      if (hasErrors(response)) {
        return {
          success: false,
          error: {
            code: "INVALID_CREDENTIALS",
            message: extractErrorMessage(response.errors) ?? "Login failed",
          },
        };
      }

      if (!response.data) {
        return {
          success: false,
          error: { code: "SERVER_ERROR", message: "No data returned" },
        };
      }

      const { auth_token, refresh_token } = response.data.login.data;
      await persist(auth_token, refresh_token);

      return { success: true, authToken: auth_token, refreshToken: refresh_token };
    },

    logout: clear,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run react/test/session-store.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add react/src/session/store.ts react/test/session-store.test.ts
git commit -m "feat(react): add the framework-free session store"
```

---

### Task 8: The transport

**Files:**
- Create: `react/src/transport.ts`
- Test: `react/test/transport.test.ts`

**Interfaces:**
- Produces:
  - `type Transport = (query: string, variables: Record<string, unknown>, headers?: Record<string, string>) => Promise<unknown>`
  - `createDirectTransport(options: { endpoint: string; getToken: () => Promise<string | null>; onUnauthorized?: () => Promise<string | null> }): Transport`

- [ ] **Step 1: Write the failing tests**

```ts
// react/test/transport.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createDirectTransport } = await import("../src/transport.js");
const { PyloError } = await import("@pylo/core");

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("createDirectTransport", () => {
  it("sends the token and returns the data envelope's contents", async () => {
    graphqlRequest.mockResolvedValue({ data: { contactList: { data: [] } } });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
    });

    const result = await transport("query {}", { a: 1 }, { "x-tenant": "acme" });

    expect(result).toEqual({ contactList: { data: [] } });
    expect(graphqlRequest).toHaveBeenCalledWith(
      "https://api.test/graphql",
      "query {}",
      { a: 1 },
      { token: "t1", headers: { "x-tenant": "acme" } },
    );
  });

  it("throws a PyloError carrying the API's error code", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "No read permission", extensions: { code: "FORBIDDEN" } }],
    });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
    });

    await expect(transport("query {}", {})).rejects.toMatchObject({
      name: "PyloError",
      message: "No read permission",
      code: "FORBIDDEN",
    });
  });

  it("refreshes once and retries when the request is unauthorized", async () => {
    graphqlRequest
      .mockResolvedValueOnce({
        errors: [{ message: "expired token", extensions: { code: "UNAUTHENTICATED" } }],
      })
      .mockResolvedValueOnce({ data: { ok: true } });

    const onUnauthorized = vi.fn(async () => "t2");
    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
      onUnauthorized,
    });

    expect(await transport("query {}", {})).toEqual({ ok: true });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(graphqlRequest.mock.calls[1]?.[3]).toMatchObject({ token: "t2" });
  });

  it("does not retry more than once", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "expired token", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
      onUnauthorized: async () => "t2",
    });

    await expect(transport("query {}", {})).rejects.toBeInstanceOf(PyloError);
    expect(graphqlRequest).toHaveBeenCalledTimes(2);
  });

  it("gives up without retrying when the refresh yields no token", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "expired token", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
      onUnauthorized: async () => null,
    });

    await expect(transport("query {}", {})).rejects.toBeInstanceOf(PyloError);
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run react/test/transport.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// react/src/transport.ts
import { graphqlRequest, hasErrors, extractErrorMessage, isUnauthorizedError } from "@pylo/auth";
import { PyloError } from "@pylo/core";

/**
 * How the hooks reach the API. `@pylo/react` talks to it directly; `@pylo/nextjs`
 * posts to its route handler so the token can stay in an httpOnly cookie.
 */
export type Transport = (
  query: string,
  variables: Record<string, unknown>,
  headers?: Record<string, string>,
) => Promise<unknown>;

export interface DirectTransportOptions {
  endpoint: string;
  getToken: () => Promise<string | null>;
  /** Called once on an unauthorized response; returns the token to retry with. */
  onUnauthorized?: () => Promise<string | null>;
}

export function createDirectTransport(options: DirectTransportOptions): Transport {
  async function send(
    query: string,
    variables: Record<string, unknown>,
    headers: Record<string, string> | undefined,
    token: string | null,
  ) {
    return graphqlRequest<Record<string, unknown>>(options.endpoint, query, variables, {
      ...(token !== null ? { token } : {}),
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  return async (query, variables, headers) => {
    let response = await send(query, variables, headers, await options.getToken());

    // A token can expire between the freshness check and the request landing.
    // One refresh and one retry turns that into a hiccup instead of an error
    // the caller has to handle.
    if (isUnauthorizedError(response) && options.onUnauthorized) {
      const token = await options.onUnauthorized();
      if (token !== null) {
        response = await send(query, variables, headers, token);
      }
    }

    if (hasErrors(response)) {
      throw new PyloError(
        extractErrorMessage(response.errors) ?? "GraphQL request failed",
        response.errors,
      );
    }

    if (!response.data) {
      throw new PyloError("No data returned from GraphQL request");
    }

    return response.data;
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run react/test/transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add react/src/transport.ts react/test/transport.test.ts
git commit -m "feat(react): add the direct transport with refresh-and-retry"
```

---

### Task 9: Move the hook factory into `@pylo/react`

**Files:**
- Create: `react/src/hooks.ts` (moved from `nextjs/src/hooks.ts`)
- Modify: `react/package.json` (add the `./hooks` export), `react/tsup.config.ts` (add the entry)

**Interfaces:**
- Consumes: `Transport` from Task 8, `usePyloTransport` from Task 10, `UploadSource` / `UploadPart` / `toUploadPart` from Task 2.
- Produces: `createPyloHooks<S>(options?: { useTransport?: () => Transport; headers?: Record<string, string> })` returning the same fifteen hooks by the same names.

The factory takes a *hook* rather than a transport value. A single-page app's transport lives in React context, because it depends on the session, and a value passed at module scope could never reach it. Defaulting to `usePyloTransport` is what makes `createPyloHooks<PyloSchema>()` work with no arguments.

- [ ] **Step 1: Move the file**

```bash
git mv nextjs/src/hooks.ts react/src/hooks.ts
```

- [ ] **Step 2: Swap the transport in**

In `react/src/hooks.ts`:

- Delete the whole `clientFetch` function (currently lines 143 to 173).
- Add `import type { Transport } from "./transport.js";` and `import { usePyloTransport } from "./provider.js";`
- Replace the `HooksOptions` interface:

```ts
interface HooksOptions {
  /** Defaults to reading the transport `PyloProvider` supplies. */
  useTransport?: () => Transport;
  headers?: Record<string, string>;
}
```

- Replace the two opening lines of `createPyloHooks`:

```ts
export function createPyloHooks<S>(options?: HooksOptions) {
  const useTransport = options?.useTransport ?? usePyloTransport;
  const globalHeaders = options?.headers;
```

- Inside each hook, take the transport before any other hook call, so it obeys the rules of hooks. Add this as the first line of every one of the fifteen hook bodies:

```ts
    const transport = useTransport();
```

- Replace every `clientFetch(apiPath, ` with `transport(` throughout the file. Verify none remain:

```bash
grep -c clientFetch react/src/hooks.ts   # must print 0
grep -c "transport(" react/src/hooks.ts  # must equal the count of clientFetch calls before the edit
```

- [ ] **Step 3: Widen the upload hook to accept any upload source**

In the `UploadHookResult` interface and `usePyloUpload`, change `startUpload`'s first parameter from `File | File[]` to `UploadSource | UploadSource[]`. Import `toUploadPart` and the types from `@pylo/core`. Replace the body's use of `file.size`, `file.name`, `file.type` with the result of `toUploadPart`:

```ts
        const parts = list.map((source) =>
          toUploadPart(source, {
            ...(opts.fileName !== undefined ? { fileName: opts.fileName } : {}),
            ...(opts.mimeType !== undefined ? { mimeType: opts.mimeType } : {}),
          }),
        );

        // React Native streams from a uri and never reports a file size, so a
        // byte-weighted total is unavailable. Fall back to weighting each file
        // equally, which keeps the percentage monotonic either way.
        const sizes = parts.map((part) => part.size);
        const grandTotal = sizes.every((size) => size !== undefined)
          ? sizes.reduce((sum, size) => sum + (size ?? 0), 0)
          : undefined;
```

Then in `reportProgress`, when `grandTotal` is undefined compute the percent from completed files:

```ts
        const loadedPerFile: number[] = new Array<number>(list.length).fill(0);
        const doneFlags: boolean[] = new Array<boolean>(list.length).fill(false);
        const reportProgress = () => {
          const loaded = loadedPerFile.reduce((sum, bytes) => sum + bytes, 0);
          const percent =
            grandTotal !== undefined
              ? grandTotal > 0
                ? Math.round((loaded / grandTotal) * 100)
                : 0
              : Math.round(
                  (doneFlags.filter(Boolean).length / doneFlags.length) * 100,
                );
          setProgress(percent);
          optionsRef.current?.onProgress?.({
            loaded,
            total: grandTotal ?? loaded,
            percent,
          });
        };
```

In the per-file loop, pass `parts[index]!.part` and `parts[index]!.fileName` to `uploadToUrl`, set `doneFlags[index] = true` where the code currently sets `loadedPerFile[index] = file.size`, and build the result from the part:

```ts
              return {
                id: uploadUrl.id,
                fileName: parts[index]!.fileName,
                mimeType: parts[index]!.mimeType,
                size: parts[index]!.size ?? 0,
              } satisfies PyloUploadedFile;
```

- [ ] **Step 4: Add the export entry**

In `react/package.json` add to `exports`:

```json
    "./hooks": { "types": "./dist/hooks.d.ts", "import": "./dist/hooks.js", "default": "./dist/hooks.js" },
```

In `react/tsup.config.ts` add `"src/hooks.ts"` to the first entry array.

- [ ] **Step 5: Typecheck**

Run: `pnpm -r build`
Expected: `@pylo/react` builds clean. `@pylo/nextjs` fails, because its hooks file is gone. Task 11 fixes that.

- [ ] **Step 6: Commit**

```bash
git add react nextjs
git commit -m "refactor(react): move the hook factory out of @pylo/nextjs behind a transport"
```

---

### Task 10: The provider and the bound client

**Files:**
- Create: `react/src/provider.tsx`
- Modify: `react/src/index.ts` (export the provider surface), `react/tsup.config.ts`
- Test: `react/test/provider.test-d.ts`

**Interfaces:**
- Consumes: `createSessionStore` (Task 7), `createDirectTransport` (Task 8), `createPyloHooks` (Task 9), `createLocalStorageAdapter` (Task 6).
- Produces:
  - `PyloProvider` with props `{ endpoint?: string; appId?: string; storage?: PyloStorage; keyPrefix?: string; headers?: Record<string, string>; getToken?: () => Promise<string | null>; children: ReactNode }`
  - `usePyloAuth(): { isLoading: boolean; isSignedIn: boolean; user: PyloUser | undefined; login; logout; getToken }`
  - `usePyloTransport(): Transport` — the default `useTransport` for the hook factory in Task 9
  - `usePyloClient<S>(): PyloClient<S>`

`getToken` and the session props are mutually exclusive. Supplying `getToken` puts the provider in escape-hatch mode: no login, no logout, no refresh.

- [ ] **Step 1: Implement**

```tsx
// react/src/provider.tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPyloClient, resolveEndpoint, type PyloClient } from "@pylo/core";
import { ME_QUERY, type AuthResult, type PyloUser, type MeResponse } from "@pylo/auth";
import { createSessionStore, type SessionState, type SessionStore } from "./session/store.js";
import { createLocalStorageAdapter, type PyloStorage } from "./session/storage.js";
import { createDirectTransport, type Transport } from "./transport.js";

interface PyloContextValue {
  transport: Transport;
  endpoint: string;
  state: SessionState;
  store: SessionStore | null;
  getToken: () => Promise<string | null>;
}

const PyloContext = createContext<PyloContextValue | null>(null);

function usePyloContext(): PyloContextValue {
  const value = useContext(PyloContext);
  if (!value) {
    throw new Error("usePylo* must be used inside <PyloProvider>");
  }
  return value;
}

export interface PyloProviderProps {
  children: ReactNode;
  endpoint?: string;
  appId?: string;
  storage?: PyloStorage;
  keyPrefix?: string;
  headers?: Record<string, string>;
  /** Escape hatch: supply a token from auth that lives elsewhere. Disables the session. */
  getToken?: () => Promise<string | null>;
}

const SIGNED_OUT: SessionState = { status: "signedOut", token: null };

export function PyloProvider(props: PyloProviderProps) {
  const queryClient = useQueryClient();
  const endpoint = resolveEndpoint(props.endpoint);

  // The provider owns one store for its lifetime. Changing auth mode mid-flight
  // is not a supported transition, so nothing here reacts to prop changes.
  const storeRef = useRef<SessionStore | null>(null);
  if (storeRef.current === null && !props.getToken) {
    storeRef.current = createSessionStore({
      endpoint,
      storage: props.storage ?? createLocalStorageAdapter(),
      ...(props.appId !== undefined ? { appId: props.appId } : {}),
      ...(props.keyPrefix !== undefined ? { keyPrefix: props.keyPrefix } : {}),
      onSignOut: () => queryClient.clear(),
    });
  }
  const store = storeRef.current;

  const state = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.getState() ?? SIGNED_OUT,
    () => store?.getState() ?? SIGNED_OUT,
  );

  useEffect(() => {
    void store?.init();
  }, [store]);

  const value = useMemo<PyloContextValue>(() => {
    const getToken = props.getToken ?? (() => store!.getToken());
    const transport = createDirectTransport({
      endpoint,
      getToken,
      ...(store ? { onUnauthorized: () => store.refresh() } : {}),
    });
    return { transport, endpoint, state, store, getToken };
    // `props.getToken` is read once per render on purpose: callers commonly
    // pass an inline closure, and re-creating the transport each time would
    // change every hook's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, state, store]);

  return <PyloContext.Provider value={value}>{props.children}</PyloContext.Provider>;
}

export function usePyloTransport(): Transport {
  return usePyloContext().transport;
}

export function usePyloClient<S>(): PyloClient<S> {
  const { endpoint, getToken } = usePyloContext();
  return useMemo(
    () =>
      createPyloClient<S>({
        endpoint,
        auth: async () => {
          const token = await getToken();
          return token !== null ? { token } : {};
        },
      }),
    [endpoint, getToken],
  );
}

export interface PyloAuth {
  isLoading: boolean;
  isSignedIn: boolean;
  user: PyloUser | undefined;
  login: (email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

export function usePyloAuth(): PyloAuth {
  const { state, store, transport, getToken } = usePyloContext();
  const isSignedIn = state.status === "signedIn";

  const me = useQuery({
    queryKey: ["pylo", "me"],
    queryFn: async () => {
      const data = (await transport(ME_QUERY, {})) as MeResponse;
      return data.me.current_user.data;
    },
    enabled: isSignedIn,
  });

  return {
    isLoading: state.status === "loading" || (isSignedIn && me.isLoading),
    isSignedIn,
    user: me.data,
    login: async (email, password) => {
      if (!store) {
        throw new Error("login is unavailable when PyloProvider is given getToken");
      }
      return store.login(email, password);
    },
    logout: async () => {
      if (!store) {
        throw new Error("logout is unavailable when PyloProvider is given getToken");
      }
      await store.logout();
    },
    getToken,
  };
}
```

- [ ] **Step 2: Wire it into the package**

Add `"src/provider.tsx"` to the first entry array in `react/tsup.config.ts` and a `./provider` export entry in `react/package.json` mirroring `./hooks`.

In `react/src/index.ts`, append:

```ts
export { PyloProvider, usePyloAuth, usePyloClient, usePyloTransport } from "./provider.js";
export type { PyloProviderProps, PyloAuth } from "./provider.js";
export { createLocalStorageAdapter, createMemoryStorage } from "./session/storage.js";
export type { PyloStorage } from "./session/storage.js";
export { createSessionStore } from "./session/store.js";
export type { SessionState, SessionStatus, SessionStore, SessionStoreOptions } from "./session/store.js";
export { createDirectTransport } from "./transport.js";
export type { Transport, DirectTransportOptions } from "./transport.js";
export { createPyloHooks } from "./hooks.js";
export type { PyloUser, AuthResult } from "@pylo/auth";
```

- [ ] **Step 3: Add the type test**

```ts
// react/test/provider.test-d.ts
import { expectTypeOf } from "vitest";
import { usePyloAuth, PyloProvider } from "../src/provider.js";
import type { PyloProviderProps } from "../src/provider.js";

const auth = usePyloAuth();
expectTypeOf(auth.isSignedIn).toEqualTypeOf<boolean>();
expectTypeOf(auth.login).toBeCallableWith("a@b.c", "pw");
expectTypeOf(auth.user).toMatchTypeOf<{ id: string; email: string } | undefined>();

// The escape hatch and the session props both type-check on their own.
const withSession = { children: null } satisfies PyloProviderProps;
const withGetToken = {
  children: null,
  getToken: async () => "t",
} satisfies PyloProviderProps;
void withSession;
void withGetToken;
void PyloProvider;
```

- [ ] **Step 4: Build and typecheck**

Run: `pnpm -r --filter=./react build && pnpm vitest run --typecheck react/test/provider.test-d.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add react
git commit -m "feat(react): add PyloProvider, usePyloAuth and the bound client"
```

---

### Task 11: Rebuild `@pylo/nextjs` on the shared factory

**Files:**
- Create: `nextjs/src/hooks.ts` (thin re-export)
- Modify: `nextjs/package.json` (dependency on `@pylo/react`)

**Interfaces:**
- Consumes: `createPyloHooks` and `Transport` from `@pylo/react`.
- Produces: `createPyloHooks<S>(options?: { apiPath?: string; headers?: Record<string, string> })` with exactly its previous behavior and hook names.

- [ ] **Step 1: Add the dependency**

In `nextjs/package.json`, add `"@pylo/react": "workspace:*"` to `dependencies`.

- [ ] **Step 2: Write the new hooks entry**

```ts
// nextjs/src/hooks.ts
"use client";

import { createPyloHooks as createSharedHooks, type Transport } from "@pylo/react";

interface HooksOptions {
  apiPath?: string;
  headers?: Record<string, string>;
}

/**
 * Posts to the app's own route handler rather than the API, so the token stays
 * in an httpOnly cookie and never reaches client JavaScript. Errors keep the
 * shape this package has always thrown.
 */
function createApiRouteTransport(apiPath: string): Transport {
  return async (query, variables, headers) => {
    const response = await fetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables,
        ...(headers !== undefined ? { headers } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `GraphQL request failed: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      data?: unknown;
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join(", "));
    }

    return json.data;
  };
}

export function createPyloHooks<S>(options?: HooksOptions) {
  // Static for the app's lifetime, so the "hook" ignores context entirely and
  // this package needs no provider — exactly as before.
  const transport = createApiRouteTransport(options?.apiPath ?? "/api/graphql");

  return createSharedHooks<S>({
    useTransport: () => transport,
    ...(options?.headers !== undefined ? { headers: options.headers } : {}),
  });
}
```

- [ ] **Step 3: Keep `@tanstack/react-query` external**

`nextjs/tsup.config.ts` already lists it. Add `"@pylo/react"` to the `external` array so the shared hooks are not inlined into two bundles.

- [ ] **Step 4: Verify the type tests still pass unchanged**

Run: `pnpm install && pnpm -r build && pnpm test`
Expected: PASS, with `nextjs/test/hooks.test-d.ts` untouched. If it fails, the shared factory's generics drifted; fix the factory, not the test.

- [ ] **Step 5: Commit**

```bash
git add nextjs pnpm-lock.yaml
git commit -m "refactor(nextjs): build the hooks on @pylo/react with a route-handler transport"
```

---

### Task 12: The `@pylo/expo` package

**Files:**
- Create: `expo/package.json`, `expo/tsconfig.json`, `expo/tsup.config.ts`, `expo/LICENSE`, `expo/src/index.ts`, `expo/src/storage.ts`, `expo/src/provider.tsx`, `expo/src/cli.ts`, `expo/src/codegen.ts`
- Test: `expo/test/storage.test.ts`

**Interfaces:**
- Consumes: everything `@pylo/react` exports.
- Produces: `createSecureStorage(): PyloStorage`, and a `PyloProvider` whose `storage` prop defaults to it. Its own `PyloRegister`, `PyloEntity`, `PyloSelect`, `PyloResult`.

- [ ] **Step 1: Create `expo/package.json`**

Same shape as `react/package.json`, with:

```json
  "name": "@pylo/expo",
  "description": "Type-safe Expo and React Native SDK for Pylo",
  "dependencies": {
    "@pylo/auth": "workspace:*",
    "@pylo/core": "workspace:*",
    "@pylo/react": "workspace:*"
  },
  "peerDependencies": {
    "@tanstack/react-query": ">=5.0.0",
    "expo-secure-store": ">=12.0.0",
    "react": ">=18.0.0"
  },
```

Exports are `.` and `./codegen`, both with `types`, `import` and `default`. Add `expo-secure-store` to `devDependencies` at `^13.0.0`.

- [ ] **Step 2: Copy the configs**

`expo/tsconfig.json` and `expo/LICENSE` copy `react/`'s. `expo/tsup.config.ts` copies `react/`'s with entries `["src/index.ts", "src/codegen.ts"]` and `external: ["react", "react/jsx-runtime", "@tanstack/react-query", "@pylo/react", "expo-secure-store"]`.

- [ ] **Step 3: Write the SecureStore adapter**

```ts
// expo/src/storage.ts
import * as SecureStore from "expo-secure-store";
import type { PyloStorage } from "@pylo/react";

// SecureStore keys allow only alphanumerics, `.`, `-` and `_`.
const sanitize = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * Keychain-backed storage. Reads and writes are async, which is why the session
 * has a loading state at all.
 */
export function createSecureStorage(): PyloStorage {
  return {
    getItem: (key) => SecureStore.getItemAsync(sanitize(key)),
    setItem: async (key, value) => {
      await SecureStore.setItemAsync(sanitize(key), value);
    },
    removeItem: async (key) => {
      await SecureStore.deleteItemAsync(sanitize(key));
    },
  };
}
```

- [ ] **Step 4: Write the failing test for it**

```ts
// expo/test/storage.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getItemAsync = vi.fn();
const setItemAsync = vi.fn();
const deleteItemAsync = vi.fn();

vi.mock("expo-secure-store", () => ({ getItemAsync, setItemAsync, deleteItemAsync }));

const { createSecureStorage } = await import("../src/storage.js");

beforeEach(() => {
  getItemAsync.mockReset();
  setItemAsync.mockReset();
  deleteItemAsync.mockReset();
});

describe("createSecureStorage", () => {
  it("sanitizes keys SecureStore would reject", async () => {
    getItemAsync.mockResolvedValue("v");
    const storage = createSecureStorage();

    expect(await storage.getItem("pylo:auth token")).toBe("v");
    expect(getItemAsync).toHaveBeenCalledWith("pylo_auth_token");

    await storage.setItem("pylo:auth token", "v");
    expect(setItemAsync).toHaveBeenCalledWith("pylo_auth_token", "v");

    await storage.removeItem("pylo:auth token");
    expect(deleteItemAsync).toHaveBeenCalledWith("pylo_auth_token");
  });

  it("leaves an already-valid key alone", async () => {
    getItemAsync.mockResolvedValue(null);
    await createSecureStorage().getItem("pylo.auth_token");
    expect(getItemAsync).toHaveBeenCalledWith("pylo.auth_token");
  });
});
```

Run: `pnpm vitest run expo/test/storage.test.ts`. Expected FAIL first, PASS after Step 3's file exists.

- [ ] **Step 5: Write the provider wrapper**

```tsx
// expo/src/provider.tsx
import { PyloProvider as BaseProvider, type PyloProviderProps } from "@pylo/react";
import { useMemo } from "react";
import { createSecureStorage } from "./storage.js";

export function PyloProvider(props: PyloProviderProps) {
  const storage = useMemo(() => props.storage ?? createSecureStorage(), [props.storage]);
  return <BaseProvider {...props} storage={storage} />;
}
```

- [ ] **Step 6: Write the public surface**

`expo/src/index.ts` re-exports everything from `@pylo/react` except `PyloProvider`, then exports its own `PyloProvider`, `createSecureStorage`, and its own `PyloRegister` / `PyloEntity` / `PyloSelect` / `PyloResult` block copied from `react/src/index.ts` with the doc comment naming `@pylo/expo`. Do not use `export *`, since `PyloProvider` must be shadowed deliberately.

`expo/src/cli.ts` copies `react/src/cli.ts` with `importSource: "@pylo/expo"`. `expo/src/codegen.ts` copies `react/src/codegen.ts`.

- [ ] **Step 7: Build and test**

Run: `pnpm install && pnpm -r build && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add expo pnpm-lock.yaml
git commit -m "feat(expo): add @pylo/expo with SecureStore-backed sessions"
```

---

### Task 13: Packaging fixtures

**Files:**
- Create: `fixtures/node/`, `fixtures/vite-react/`, `fixtures/nextjs/`, `fixtures/expo/`, `scripts/check-fixtures.sh`
- Modify: root `package.json`

**Interfaces:**
- Produces: a root script `pnpm check:fixtures` that packs every publishable package, installs the tarballs into each fixture, and typechecks and builds it.

Fixtures are excluded from the pnpm workspace so they resolve tarballs rather than workspace links, which is the point of the exercise.

- [ ] **Step 1: Exclude fixtures from the workspace**

In `pnpm-workspace.yaml`, add `- "!fixtures/**"` to `packages`.

- [ ] **Step 2: Write the script**

Tarball filenames carry each package's current version, so nothing pins them by name. The fixtures declare no Pylo dependencies and the script installs the tarballs by glob.

```bash
#!/usr/bin/env bash
# scripts/check-fixtures.sh
# Installs packed tarballs into throwaway apps, so resolution and types are
# exercised the way a consumer sees them rather than through workspace links.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/.fixture-tarballs"
rm -rf "$out" && mkdir -p "$out"

for pkg in auth auth-nextjs core node react expo nextjs; do
  (cd "$root/$pkg" && pnpm pack --pack-destination "$out" >/dev/null)
done

tarball() { echo "$out"/pylo-"$1"-*.tgz; }

install_into() {
  local fixture="$1"; shift
  (
    cd "$fixture"
    rm -rf node_modules package-lock.json
    npm install --no-audit --no-fund
    # shellcheck disable=SC2046
    npm install --no-audit --no-fund $(for p in "$@"; do tarball "$p"; done)
    npm run check
  )
}

echo "==> node";        install_into "$root/fixtures/node" auth core node
echo "==> vite-react";  install_into "$root/fixtures/vite-react" auth core react
echo "==> nextjs";      install_into "$root/fixtures/nextjs" auth auth-nextjs core react nextjs
echo "==> expo";        install_into "$root/fixtures/expo" auth core react expo
```

Make it executable with `chmod +x scripts/check-fixtures.sh`, and add `.fixture-tarballs/` plus `fixtures/*/node_modules/` to `.gitignore`.

- [ ] **Step 3: Create the Node fixture**

`fixtures/node/package.json`:

```json
{
  "name": "fixture-node",
  "private": true,
  "type": "module",
  "scripts": { "check": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.9.3", "@types/node": "^22.19.7" }
}
```

`fixtures/node/tsconfig.json` uses the strictest consumer setup, which is also the one most likely to reject a bad export map:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

`fixtures/node/index.ts`:

```ts
import { createPyloNode, PyloError } from "@pylo/node";
import type { PyloClient } from "@pylo/node";

const client: PyloClient<any> = createPyloNode({ apiKey: "k" });

void client;
void PyloError;
```

- [ ] **Step 4: Create the Vite React fixture**

`fixtures/vite-react/package.json`:

```json
{
  "name": "fixture-vite-react",
  "private": true,
  "type": "module",
  "scripts": { "check": "tsc --noEmit && vite build" },
  "dependencies": {
    "@tanstack/react-query": "^5.90.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.9.3",
    "vite": "^6.0.0"
  }
}
```

`fixtures/vite-react/tsconfig.json` is the Node fixture's with `"module": "esnext"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`, `"lib": ["dom", "es2022"]`, `"types": []`, and `"include": ["src"]`.

`fixtures/vite-react/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
```

`fixtures/vite-react/index.html` is a single `<div id="root">` plus `<script type="module" src="/src/main.tsx">`.

`fixtures/vite-react/src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PyloProvider, usePyloAuth, usePyloClient, createPyloHooks, usePyloTransport } from "@pylo/react";

const { usePyloList, usePyloUpload } = createPyloHooks<any>();

function Screen() {
  const { isLoading, isSignedIn, user, login, logout } = usePyloAuth();
  const client = usePyloClient<any>();
  const transport = usePyloTransport();
  const { data } = usePyloList("contact", { select: { id: true } });
  const { startUpload } = usePyloUpload();

  void client;
  void transport;
  void startUpload;

  if (isLoading) return <p>loading</p>;
  return isSignedIn ? (
    <button onClick={() => void logout()}>{user?.email ?? String(data?.length)}</button>
  ) : (
    <button onClick={() => void login("a@b.c", "pw")}>sign in</button>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <PyloProvider>
      <Screen />
    </PyloProvider>
  </QueryClientProvider>,
);
```

- [ ] **Step 5: Create the Next.js fixture**

`fixtures/nextjs/package.json` has `"check": "next build"`, depends on `next@^16.0.0`, `react`, `react-dom` and `@tanstack/react-query`, and dev-depends on `typescript` and the React types. Its `tsconfig.json` matches the Vite fixture's with `"moduleResolution": "bundler"` and `"plugins": [{ "name": "next" }]`.

`fixtures/nextjs/app/api/graphql/route.ts`:

```ts
import { createPyloApiRoute } from "@pylo/nextjs/api";

export const { POST } = createPyloApiRoute();
```

`fixtures/nextjs/app/page.tsx`:

```tsx
import { createPyloServer } from "@pylo/nextjs/server";

export default async function Page() {
  const pylo = createPyloServer<any>({ apiKey: "k" });
  void pylo;
  return <p>ok</p>;
}
```

`fixtures/nextjs/app/client.tsx`:

```tsx
"use client";

import { createPyloHooks } from "@pylo/nextjs/hooks";

const { usePyloList } = createPyloHooks<any>();

export function Contacts() {
  const { data } = usePyloList("contact", { select: { id: true } });
  return <p>{data?.length ?? 0}</p>;
}
```

`fixtures/nextjs/app/layout.tsx` is a minimal root layout returning `<html><body>{children}</body></html>`.

- [ ] **Step 6: Create the Expo fixture**

`fixtures/expo/package.json`:

```json
{
  "name": "fixture-expo",
  "private": true,
  "main": "index.ts",
  "scripts": { "check": "tsc --noEmit && npx expo export --platform ios --output-dir .export" },
  "dependencies": {
    "@tanstack/react-query": "^5.90.0",
    "expo": "^54.0.0",
    "expo-secure-store": "^13.0.0",
    "react": "^19.0.0",
    "react-native": "^0.81.0"
  },
  "devDependencies": { "@types/react": "^19.0.0", "typescript": "^5.9.3" }
}
```

`fixtures/expo/tsconfig.json` extends `expo/tsconfig.base` with `"strict": true` and `"noEmit": true`.

`fixtures/expo/index.ts` registers the root component and imports the duplicate check:

```ts
import { registerRootComponent } from "expo";
import "./single-instance";
import App from "./App";

registerRootComponent(App);
```

`fixtures/expo/App.tsx`:

```tsx
import { Button, Text, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PyloProvider, usePyloAuth, createPyloHooks } from "@pylo/expo";

const { usePyloList, usePyloUpload } = createPyloHooks<any>();

function Screen() {
  const { isLoading, isSignedIn, user, login, logout } = usePyloAuth();
  const { data } = usePyloList("contact", { select: { id: true } });
  const { startUpload } = usePyloUpload();

  // The React Native upload source: a uri, not a File.
  const pick = () =>
    void startUpload({ uri: "file:///tmp/a.png", name: "a.png", type: "image/png" });

  if (isLoading) return <Text>loading</Text>;
  return (
    <View>
      <Text>{user?.email ?? String(data?.length ?? 0)}</Text>
      <Button title="upload" onPress={pick} />
      <Button
        title={isSignedIn ? "sign out" : "sign in"}
        onPress={() => void (isSignedIn ? logout() : login("a@b.c", "pw"))}
      />
    </View>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PyloProvider>
        <Screen />
      </PyloProvider>
    </QueryClientProvider>
  );
}
```

`fixtures/expo/app.json` is the Expo default with a name and slug of `fixture-expo`.

- [ ] **Step 7: Add the script and run everything**

Add `"check:fixtures": "bash scripts/check-fixtures.sh"` to the root `package.json`.

Run: `pnpm -r build && pnpm check:packaging && pnpm check:fixtures`
Expected: all four fixtures install, typecheck and build. Fix any resolution failure in the package's `exports`, never in the fixture's config.

- [ ] **Step 8: Commit**

```bash
git add fixtures scripts package.json pnpm-workspace.yaml
git commit -m "test: install packed tarballs into Node, Vite, Next.js and Expo fixtures"
```

---

### Task 14: Documentation and release

**Files:**
- Create: `react/README.md`, `expo/README.md`, `.changeset/react-expo-sdk.md`
- Modify: `README.md` (root package table)

- [ ] **Step 1: Write `react/README.md`**

Cover installation, the two-provider setup with `QueryClientProvider`, `usePyloAuth`, running `pylo generate`, and the `getToken` escape hatch. Include the storage security note verbatim:

> Tokens are stored in `localStorage`, which any script running on your page can read. Refresh tokens rotate on every use, but a strong Content Security Policy is what actually protects them. If your app has a backend, keep the tokens there instead and proxy requests through it.

- [ ] **Step 2: Write `expo/README.md`**

Same shape, with SecureStore instead of localStorage, and a section pointing at the TanStack Query React Native guide for wiring `AppState` to `focusManager`, which this release deliberately does not ship. Include the snippet:

```ts
import { AppState, type AppStateStatus } from "react-native";
import { focusManager } from "@tanstack/react-query";

AppState.addEventListener("change", (status: AppStateStatus) => {
  focusManager.setFocused(status === "active");
});
```

- [ ] **Step 3: Add the changeset**

```markdown
---
"@pylo/react": minor
"@pylo/expo": minor
"@pylo/core": minor
"@pylo/nextjs": patch
---

Add `@pylo/react` and `@pylo/expo`, and move `@pylo/nextjs` onto the shared hook
factory. `@pylo/core` accepts a React Native file reference as an upload source
and no longer assumes `process` exists. `@pylo/nextjs` keeps its public surface.
```

Set `react/package.json` and `expo/package.json` versions to `0.0.0` so changesets publishes them at `0.1.0`.

- [ ] **Step 4: Full verification**

Run: `pnpm -r build && pnpm test && pnpm lint && pnpm check:packaging && pnpm check:fixtures`
Expected: every command passes. Report the actual output; do not claim success without it.

- [ ] **Step 5: Commit**

```bash
git add react/README.md expo/README.md README.md .changeset
git commit -m "docs: document @pylo/react and @pylo/expo and add the release changeset"
```
