// Root stub so TS with legacy moduleResolution (node10), which ignores the
// package.json "exports" field, can still find the "./codegen" subpath types.
export * from "./dist/codegen/index.js";
