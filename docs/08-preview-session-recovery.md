# Preview session recovery — 0.4.1

The user still receives accepted-password/missing-session errors after partitioned cookies were enabled. Local cross-site cookie tests did not prove cookie delivery through the user's actual preview/browser/proxy. The precise external failure point is not confirmed; do not claim it is fixed by asking the user to reset a valid password.

## Bounded correction

An explicit ENABLE_PREVIEW_MEMORY_SESSION=true flag enables an alternative session transport only in development; enabling it with NODE_ENV=production must fail startup. Default remains cookie-only. The client opts in with X-ERP-Session-Transport: memory at password login; only successful password authentication may return an opaque previewSessionToken. This is the same hashed, revocable, expiring server session as cookie authentication—not a demo-user bypass or new authority.

In this mode the client sends X-ERP-Session on same-origin API requests. The header is authoritative: invalid or disabled header authentication never falls through to a valid cookie. All existing CSRF, RBAC, membership, segregation, idle/absolute expiry and command revalidation still run. Do not allow permissive CORS. Authentication responses must be no-store. No token may be put in a URL, localStorage, sessionStorage, audit, telemetry or logs. Login tokens are JavaScript-readable while in memory, so this is not equivalent to HttpOnly-cookie protection and must not be presented as production authentication.

GET /auth/config reports only whether this development option is enabled. When enabled, the UI does not automatically restore cookies after a reload, preventing stale cookie identity from replacing a lost in-memory session. Successful preview login expires the previous configured cookie and does not issue a new cookie. The UI shows an explicit reload/sign-in notice; logout and revocation clear the memory credential. A late response from an earlier authentication attempt must not replace or clear the current session.

## Verification

Write backend tests for default/production fail-closed configuration, successful password-only token issuance, invalid-password denial, no token in normal login, cookie-free authenticated reads, authoritative header identity, tenant/RBAC and CSRF denial, expiry/logout revocation and no-store responses. Browser-test the actual UI behind a test proxy that strips every Set-Cookie and Cookie header, not a test that manually supplies a cookie. Verify control-center navigation, a CSRF-protected session revocation, reload requiring reauthentication, and no session credential in browser storage. Re-run the cookie-only test with the memory negotiation removed to preserve coverage of both modes. Real Arena/browser confirmation still requires the user's retry.

## Executed evidence — 26 September 2026

- Red tests failed before implementation (missing no-store/transport policy). Backend implementation then passed; final expanded suite: **60 tests, 60 passed** on Node 22 and PostgreSQL 17.
- `docs/browser-preview-memory-result.json`: ten Chromium UI/security checks passed in a real local cross-site TLS iframe with all Cookie/Set-Cookie headers stripped; zero page errors.
- `docs/browser-embedded-result.json`: separate ephemeral API with the flag disabled; real HttpOnly/partitioned-cookie login, reload, CSRF denial and logout passed. Does not alter the running sandbox configuration.
- `docs/browser-organization-result.json`: all twelve configuration workflow checks passed using the memory transport.
- Finance regression initially timed out twice at revision dialog dismissal without a failed server response. Diagnostic and unchanged-script reruns passed, latest source JDR-2026-000005. Root cause of the intermittent UI timing remains open; do not misrepresent the suite as consistently green or this patch as fixing that issue.
- The running development preview uses the new mode. **Actual Arena traffic authorization and the user's browser are not accessible to these tests; user retry remains the final environment-specific confirmation.** No valid password reset is needed.

### Loading-state regression caught during final retest

A post-revocation login stalled when an old workspace refresh was still pending. A deterministic test now holds that refresh across self-revocation; it failed before the correction (sign-in remained disabled as “Signing in…”). Background refresh and mutating-command loading states are now separate, and clearing the local session resets both. The test passes without retrying the click or sleeping to hide the race. The finance workflow passed afterward; its earlier revision-dialog timeouts are retained above rather than retroactively claiming their exact cause was proven.
