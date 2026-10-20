---
"@pylo/core": minor
"@pylo/node": minor
"@pylo/react": minor
"@pylo/expo": minor
"@pylo/nextjs": minor
---

`client.<entity>.subscribe({ select, filter }, { onEvent, onResync, onError })` streams creates, updates and deletes of the matching rows over one shared websocket. Each event carries the row under `select`, or `removed: true` when the row was deleted or left the filter. Identical subscriptions share one server registration; the connection reconnects, re-registers and calls `onResync` on its own, and a dropped subscription is deleted server-side. `client.realtime` exposes `isLive(entity)`, `getStatus()`, `wake()` and `close()`, and `createRealtime` builds the same connection on a custom transport.

`createPyloNode` takes `realtime: { WebSocket }` for Node before 22, which has no global WebSocket. Subscribing through the injected flow-action client throws, because an action ends before events arrive.

`usePyloList`, `usePyloInfiniteList` and `usePyloById` take `live: true`: updates and removals are patched into the cache, and anything the cache can't place correctly (a row entering the filter, a changed sort field, a create under a non-newest-first sort) triggers a background refetch. Mutation hooks skip refetching queries a live hook keeps current. `usePyloSubscription` calls a handler per event without touching the cache. With request headers set, events only trigger refetches, since the server can't apply headers to the event projection.

`@pylo/expo` checks the connection when the app returns to the foreground. `@pylo/nextjs` adds `createPyloWsTokenRoute`, mounted at `/api/pylo/ws-token` by default, which the browser's socket authenticates through.
