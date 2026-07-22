---
"@pylo/core": patch
"@pylo/node": patch
"@pylo/nextjs": patch
---

Fix relations being dropped from query result types

On `list()` / `byId()` (`@pylo/core`, `@pylo/node`), selecting a relation that also
carried a `filter` or `pagination` key silently removed that relation from the
returned type, so `row.order_lines` did not exist on the result. Scalar fields were
unaffected and there was no compile error at the call site — only the relation went
missing.

The cause was `ListOptions.select` being typed as `StrictSelect<Sel, Valid>`, i.e.
`Valid & { [K in keyof Sel]: ... }`. That made a mapped type the only inference site
for `Sel`, so TypeScript reverse-mapped the selection and lost the literal shape of
any relation entry with extra keys. `RelationResult` then failed its
`Select[K] extends { select: infer SubSelect }` check and produced `never`, which
`OmitNever` stripped from the result.

`select` is now typed as the bare `Sel`, which preserves exact inference, and the
unknown-key check moved into the type parameter's constraint via the new
`SelectConstraint` / `NoExcess` helpers.

The `usePyloList` / `usePyloInfiniteList` / `usePyloById` hooks (`@pylo/nextjs`) were
broken more severely and for a different reason: they infer the entity `E` from their
first argument, so `Sel`'s constraint could not be used to contextually type the
select. `true` widened to `boolean`, `Sel` fell back to its constraint, and *every*
relation was dropped — with or without `filter` / `pagination`. Their `Sel` is now a
`const` type parameter, which preserves the literal selection without relying on a
contextual type.

Known gap: because the hooks' `select` has no contextual type, an unknown key nested
inside a relation's `select` is not rejected there (unknown top-level keys, unknown
keys via a variable, and `relation: true` still are). `list()` / `byId()` reject all
of these.

`StrictSelect` is no longer exported; it was only ever used to type `select`.
