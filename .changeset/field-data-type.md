---
"@pylo/core": minor
"@pylo/node": minor
---

`AnalyzedField` now carries `dataType`, Pylo's own field type (`RICHTEXT`, `DATETIME`, `JSON`, …). `tsType` maps several of them to `string`, so this is the only way to tell them apart.
