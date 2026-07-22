# @pylo/nextjs

## 0.2.2

### Patch Changes

- Add `client.me()`, and make virtual entities uncallable

  `entityList` returns virtual entities such as `me` and `pyloEventData` alongside
  real ones. Codegen emitted them like any other entity, so the generated schema
  advertised `client.me.list()` and `client.pyloEventData.upsert()` — calls that
  can never succeed, because these entities have no endpoints.

  Codegen now marks entities flagged `is_system_entity` with `virtual: true` in
  `PyloSchema` and emits no create/update input types for them. Their field and
  relation shapes stay in the schema, so `select` and `EntityResult` keep working
  against them; `PyloClient` drops the keys, so `client.me` / `client.pyloEventData`
  are no longer callable as entities. The `usePylo*` hooks are constrained the
  same way.

  `me` is served by a dedicated endpoint that types exactly like `byId` — same
  required `select`, same result inference, no `id` argument (the server resolves
  the subject from the request credentials):

  ```ts
  const me = await client.me({
    select: {
      authenticaton_method: true,
      current_user: { select: { id: true, email: true } },
      my_users: { select: { id: true }, pagination: { per_page: 10 } },
    },
  });
  me.current_user?.data.email;
  ```

  The selection is built with the same machinery as `byId`, so relations, nested
  selects, filters and pagination all behave identically. Unlike `<entity>ById`,
  the `me` payload is not wrapped in a `data` envelope.

  `@pylo/nextjs` gains a matching `usePyloMe` hook with the same signature minus
  the id:

  ```ts
  const { data, isLoading } = usePyloMe({
    select: {
      authenticaton_method: true,
      current_user: { select: { email: true } },
    },
  });
  ```

  New exported types: `Me`, `CallableEntityName`, `VirtualEntityName`. The
  `buildMeQuery` builder is exported from `@pylo/core` alongside `buildByIdQuery`.

  `@pylo/auth` keeps its own narrower `ME_QUERY` for the login flow, so
  `getUser()` in `@pylo/auth-nextjs` is unchanged.

- Updated dependencies
  - @pylo/core@0.2.2

## 0.2.1

### Patch Changes

- e78e3c1: Fix relations being dropped from query result types

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
  select. `true` widened to `boolean`, `Sel` fell back to its constraint, and _every_
  relation was dropped — with or without `filter` / `pagination`. Their `Sel` is now a
  `const` type parameter, which preserves the literal selection without relying on a
  contextual type.

  Known gap: because the hooks' `select` has no contextual type, an unknown key nested
  inside a relation's `select` is not rejected there (unknown top-level keys, unknown
  keys via a variable, and `relation: true` still are). `list()` / `byId()` reject all
  of these.

  `StrictSelect` is no longer exported; it was only ever used to type `select`.

- Updated dependencies [e78e3c1]
  - @pylo/core@0.2.1

## 0.2.0

### Minor Changes

- adds upsert functionality to sdks

### Patch Changes

- Updated dependencies
  - @pylo/core@0.2.0

## 0.1.3

### Patch Changes

- Updated dependencies
  - @pylo/auth-nextjs@0.1.6

## 0.1.2

### Patch Changes

- Updated dependencies
  - @pylo/auth-nextjs@0.1.5

## 0.1.1

### Patch Changes

- fixed json fields in schema generation
- Updated dependencies
  - @pylo/core@0.1.1

## 0.0.15

### Patch Changes

- adds option to list pylo event data
- Updated dependencies
  - @pylo/core@0.0.14

## 0.0.14

### Patch Changes

- adds functions for ingesting events in pylo
- Updated dependencies
  - @pylo/core@0.0.13

## 0.0.13

### Patch Changes

- fix ts error
- Updated dependencies
  - @pylo/auth-nextjs@0.1.4
  - @pylo/core@0.0.12
  - @pylo/auth@0.0.5

## 0.0.12

### Patch Changes

- 47d3886: adds option for dry run and do not trigger flows to sdk
- Updated dependencies [47d3886]
  - @pylo/core@0.0.11

## 0.0.11

### Patch Changes

- feat: adds support for enum fields
- Updated dependencies
  - @pylo/core@0.0.10

## 0.0.10

### Patch Changes

- support for next js api route import
- Updated dependencies
  - @pylo/auth-nextjs@0.1.3

## 0.0.9

### Patch Changes

- fix types for \_set types
- Updated dependencies
  - @pylo/core@0.0.9

## 0.0.8

### Patch Changes

- Updated dependencies
  - @pylo/core@0.0.8

## 0.0.7

### Patch Changes

- fix by id query
- Updated dependencies
  - @pylo/core@0.0.7

## 0.0.6

### Patch Changes

- see commit
- Updated dependencies
  - @pylo/core@0.0.6

## 0.0.5

### Patch Changes

- see commit
- Updated dependencies
  - @pylo/auth@0.0.4
  - @pylo/core@0.0.5
  - @pylo/auth-nextjs@0.1.2

## 0.0.4

### Patch Changes

- fixes for the cli

## 0.0.3

### Patch Changes

- fixes the reexport of the cli bin
- Updated dependencies
  - @pylo/core@0.0.4

## 0.0.2

### Patch Changes

- fixes a bug in the core package
- Updated dependencies
  - @pylo/auth-nextjs@0.1.1
  - @pylo/auth@0.0.3
  - @pylo/core@0.0.3
