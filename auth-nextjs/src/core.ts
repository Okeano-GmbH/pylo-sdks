// Re-export everything from core auth package
// This can be safely imported in Route Handlers
export * from "@pylo/auth";

// Also export getAuthToken for use in API routes
// (importing from main index.ts brings in middleware code that breaks in route handlers)
export { getAuthToken } from "./cookies.js";
