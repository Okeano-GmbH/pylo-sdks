---
"@pylo/core": minor
"@pylo/node": minor
"@pylo/nextjs": minor
---

Typed document rendering: `pylo.documents.generate(templateKey, variables, options?)` calls `generateDocument`, stores the PDF and returns the document row with its `media_id`. Codegen reads each template's `input_schema` and emits a `PyloDocumentTemplates` map plus an `<Entity>DocumentRef` per addressed entity, so the variables are checked against the template the key names: an entity input takes the record's id, or an object that identifies one (`id` / `__search_value`) and overrides the fetched fields for that render.
