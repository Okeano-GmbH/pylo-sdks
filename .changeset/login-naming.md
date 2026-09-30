---
"@pylo/auth": minor
"@pylo/react": minor
"@pylo/expo": minor
"@pylo/core": patch
---

Say login instead of sign-in, matching `login()`, `logout()` and `loggedIn()`. Renamed, with no aliases:

- `usePyloAuth()`: `isSignedIn` → `isLoggedIn`, `signInWith` → `loginWith`, `completeSignIn` → `completeLogin`
- `AuthError["code"]`: `"SIGN_IN_FAILED"` → `"LOGIN_FAILED"`
- Session status: `"signedIn"` / `"signedOut"` → `"loggedIn"` / `"loggedOut"`
- `createSessionStore` options: `onSignIn` / `onSignOut` → `onLogin` / `onLogout`
- Types: `SocialSignIn` → `SocialLogin`, `SocialSignInResult` → `SocialLoginResult`

Error messages now say "Login failed" and "Login was cancelled".
