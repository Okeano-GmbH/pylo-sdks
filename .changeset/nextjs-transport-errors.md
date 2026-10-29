---
"@pylo/nextjs": minor
---

Hook requests that fail now throw a `PyloError` that carries `httpStatus` and the API's `code`, so an app can tell an ended session apart from other errors without matching on the message. `isPyloUnauthorized(error)` does that check. `createApiRouteTransport` and `fetchWsToken` are exported from `@pylo/nextjs/hooks` for apps that build their own provider or realtime connection.
