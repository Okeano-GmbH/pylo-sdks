---
"@pylo/core": minor
"@pylo/node": minor
---

`client.<entity>.subscribe({ select, filter }, { onEvent, onResync, onError })` streams creates, updates and deletes of the matching rows over one shared websocket. Each event carries the row under `select`, or `removed: true` when the row was deleted or left the filter. Identical subscriptions share one server registration; the connection reconnects, re-registers and calls `onResync` on its own, and a dropped subscription is deleted server-side. `client.realtime` exposes `isLive(entity)`, `getStatus()`, `wake()` and `close()`, and `createRealtime` builds the same connection on a custom transport.

`createPyloNode` takes `realtime: { WebSocket }` for Node before 22, which has no global WebSocket. Subscribing through the injected flow-action client throws, because an action ends before events arrive.
