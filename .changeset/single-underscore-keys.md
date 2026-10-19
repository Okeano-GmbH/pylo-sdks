---
"@pylo/core": minor
"@pylo/node": minor
"@pylo/nextjs": minor
"@pylo/react": minor
"@pylo/expo": minor
---

Generated types use `_search_value` and `_replace_vars` instead of `__search_value` and `__replace_vars`. GraphQL reserves the `__` prefix for introspection, so strict tools reject the old names.

After running `pylo generate` again, rename the keys in your upserts and document template inputs:

```ts
await client.contact.upsert({
  _search_value: { field: "email", value: "a@b.de" }, // was __search_value
  name: "Ada",
});
```

Requires a Pylo backend that accepts the new keys. The backend still accepts the old names, so code that is not regenerated keeps working at runtime.
