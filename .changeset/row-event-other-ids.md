---
"@pylo/react": patch
---

Live `usePyloById` no longer clears its row when another record of the same entity changes. The server reports such records as removed from the subscription, and the hook applied that to its own row.
