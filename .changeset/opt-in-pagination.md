---
"@pylo/core": minor
"@pylo/react": minor
"@pylo/expo": minor
"@pylo/nextjs": minor
"@pylo/node": minor
---

Pagination fields are selected like any other field, under the reserved `_pagination` key in `select`. The result carries exactly the fields you pick, and without `_pagination` none are requested. `pagination` still takes only the page arguments.

```ts
const { data, pagination } = await client.contact.list({
  select: { id: true, _pagination: { has_more_pages: true } },
  pagination: { page: 2 },
});
pagination.has_more_pages; // `total` is neither fetched nor typed
```

This applies to `<entity>.list()`, `usePyloList()` and nested hasMany relations. Previously, list queries always fetched every pagination field, and relations fetched them all whenever `pagination` was set. `events.list()` and `usePyloEventList()` have no `select`, so they take `_pagination` as an option. `usePyloInfiniteList()` always returns `current_page` and `has_more_pages`, and `_pagination` adds more fields.

On entity lists, picking fewer fields also makes the query cheaper: the server only counts rows when you select `total`, `last_page` or `has_more_pages`, and for a top-level list with only `has_more_pages` the count is capped.
