---
"@pylo/nextjs": patch
---

`createPyloApiRoute` answers 401 when Pylo rejects the session's token, instead of 200. Clients branch on that status to send the user back to login, so a rejected token had looked like an ordinary GraphQL error.
