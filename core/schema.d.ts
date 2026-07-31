// Root stub so TS with legacy moduleResolution (node10), which ignores the
// package.json "exports" field, can still find the "./schema" subpath types.
export * from "./dist/schema.js";
