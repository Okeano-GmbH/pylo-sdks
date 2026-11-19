---
"@pylo/auth-nextjs": patch
---

When the middleware refreshes the tokens on a page read (a document, RSC navigation or prefetch GET), it now answers with a 307 to the same URL that carries the new cookies, instead of passing the request through. On Vercel, a prerendered page or segment prefetch comes from the CDN cache, which dropped the Set-Cookie of the pass-through response. The browser kept the rotated refresh token, and once the API's 60 s grace period had passed it took the next refresh for a replay and deleted the session. Users with an idle open tab were logged out this way. API routes and Server Actions still pass through with the new token.
