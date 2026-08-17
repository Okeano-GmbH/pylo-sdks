---
"@pylo/core": patch
"@pylo/node": patch
"@pylo/nextjs": patch
---

fix: allow relation selects of any depth

`EntitySelect` and `EntityResult` carried a manual `Depth`/`Increment` recursion
counter that capped nesting at 4 usable relation hops — the 5th hop's `select`
collapsed to `Record<string, never>`, so a valid query failed to compile with
`Type '{ select: … }' is not assignable to type 'never'`, and the result type
widened to `Record<string, unknown>`.

The runtime query builder never had this limit, and neither does the backend, so
any query deeper than four hops was a type error on a request that would have
succeeded.

The counter turned out to be unnecessary. `EntitySelect` recurses only in a
mapped type's property-type position (lazily evaluated), and `EntityResult`
recurses over `keyof Select & keyof EntityRelations` — driven by the finite
select object. Neither can diverge, even on a cyclic relation graph. Removing it
also drops ~2,000 type instantiations, since `Depth` forced six separate
uncacheable instantiations per entity.

Selects are now unbounded and stay fully typed at the leaf; unknown fields and
relations are still rejected at any depth.
