---
"@pylo/core": minor
---

`client.<entity>.subscribe({ select, filter }, { onEvent, onResync, onError })` streams creates, updates and deletes of the matching rows over one shared websocket. Each event carries the row under `select`, or `removed: true` when the row was deleted or left the filter. Identical subscriptions share one server registration; the connection reconnects, re-registers and calls `onResync` on its own. `client.realtime` exposes `isLive(entity)`, `getStatus()`, `wake()` and `close()`, and `createRealtime` builds the same connection on a custom transport.
