# Browser session bootstrap and cookie resumption

Implementation follow-up after the cross-site regression found a real race: the cookie-mode initial `/auth/me` probe could return 401 after a user typed a password, clearing that input before submit. The failed run had no login POST, not an accepted-password failure or a rate-limit response.

The sign-in fields and submit control must remain disabled with an explicit checking-session state until bootstrap finishes. This is a client readiness gate, not a substitute for authentication. On failure, allow ordinary password sign-in; never create a guest/demo session. Preview memory mode still requires a new password sign-in after reload.

Cookie resumption also requires the matching anti-CSRF context. An optional `X-ERP-Resume-Session: verify-csrf` header on GET `/auth/me` requests the same existing server-side session/CSRF proof used by unsafe operations. Missing/wrong proof fails; invalid header values fail validation. Ordinary authenticated identity reads retain their existing contract. No token is returned or recovered by this operation, and no server security check is weakened.

The UI does not silently resume a cookie session when this tab lacks its anti-CSRF value. It requests password sign-in instead. A stale anti-CSRF response clears local session state and explains that reauthentication is required, rather than leaving a workspace whose commands and logout cannot work. A fresh tab without copied sessionStorage therefore needs sign-in; seamless multi-tab CSRF recovery is not claimed. Shared-cookie identity changes must never authorize a command using the previous tab's identity.

Tests: held bootstrap response with disabled sign-in controls; valid cookie/CSRF reload; missing/stale CSRF resumption; normal identity-read compatibility; forged unsafe CSRF remains denied; partitioned-cookie logout still clears the cookie. No arbitrary sleeps or longer timeout may mask the initial race.

Executed evidence: the held-bootstrap test initially failed because fields were enabled; the backend proof test initially returned 200 instead of 403. After correction the complete backend suite passes 123 tests, the expanded cookie iframe test passes eight checks, all nine browser suites pass together, and the optimized production-web smoke passes. These tests do not confirm Arena platform traffic authorization or a production backend.
