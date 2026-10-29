---
"@pylo/auth": patch
"@pylo/auth-nextjs": patch
---

`graphqlRequest` records the HTTP status on every error of a non-2xx response, and `isUnauthorizedError` treats any 401 as unauthorized. The API answers an undecodable refresh token with 401 and `INTERNAL_SERVER_ERROR`, which the middleware had taken for a transient failure, so it kept a dead session and retried the refresh on every request. The middleware also drops client-sent `x-pylo-auth-*` headers, so only it can hand route handlers a token or an auth flag.
