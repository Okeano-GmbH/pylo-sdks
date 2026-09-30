---
"@pylo/auth-nextjs": patch
"@pylo/react": patch
---

Failed sign-ins now report "Sign-in failed" instead of "Login failed", matching Pylo's broker messages and the `SIGN_IN_FAILED` error code. `@pylo/auth-nextjs` passes this text to your login page as `?error=`, so apps that show it get the new wording.
