---
"@pylo/auth-nextjs": patch
---

Fix the JSDoc examples: they imported from `@okeano-gmbh/pylo-auth-nextjs`, which does not exist on
npm. The `createPyloProxy` example no longer carries its own `config.matcher` — that belongs to the
setup guide, and the copy here had a broken escape.
