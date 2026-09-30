# Troubleshooting

## Password accepted but workspace does not open in Arena

Open/reload the actual live preview card and use the existing private development credentials. The configured sandbox can negotiate the explicitly enabled memory session. Reloading intentionally clears it and requires sign-in again. Do not copy a traffic token into the URL or put a session token in localStorage. Cookie-only production behavior must not be weakened. Local cross-site iframe tests pass but cannot prove the platform's private traffic-auth layer; actual user confirmation remains outstanding.

Next development hosting disables the React debug WebSocket channel so hydration works through an HTTP-only proxy. This is a development tooling fix, not an authentication bypass. If scripts load but the UI stalls, inspect browser/page errors and the proxy response; do not remove CSP/session checks without evidence. Production nonce-CSP/hydration is separately tested.

## 401 / 403 / 409 / 422

- 401: session expired/revoked or identity no longer active; sign in again. A supplied invalid memory credential intentionally never falls back to another user's cookie.
- 403: missing current grant, membership, branch scope, CSRF or independent actor requirement. Correct the delegated permissions/workflow; do not hard-code an admin role bypass.
- 409: stale version/state, duplicate reference or changed request using an old idempotency key. Reload; retry an uncertain original command with its original key and unchanged payload.
- 422: validation/business/DB integrity constraint. Use the request ID to inspect safe operational logs and audit. No ledger or stock balance should be directly edited to bypass it.

## Readiness 503

Call `/api/health/live` and `/api/health/ready` separately. Liveness may correctly remain 200 while DB is unavailable. Verify DB connectivity, exact migration checksum set, worker heartbeat freshness (60 seconds), and required storage permissions. API readiness is not an SMTP delivery test. A restored or image-rolled-back instance may reject a migration manifest mismatch; do not delete migration history to force green status.

## Reset email absent

Development file mode writes private `.runtime/mail` messages; it sends no email. Production requires SMTP and a dedicated worker role. Inspect worker liveness, safe outbox delivery status and provider acceptance on the staging/production host. Never print the encrypted payload, reset link, SMTP credential or reset key in an issue report. Retrying delivery may produce a repeated message; the token remains single-use.

## Recovery refuses an archive

Check archive and sidecar manifest, correct independent encryption key, explicit confirmation and a new `erp_restore_*` database/new file directory. Existing/live targets, tampering, wrong keys, symlinks and traversal are intentionally rejected. Restore into isolation and reconcile first; never overwrite the current DB just to test recovery.

## Docker preview/deployment unavailable

Docker/Compose CLIs were installed and native Compose validation passed. User namespaces are available, but a real rootless daemon failed on TAP permissions; no working container engine was obtained. Do not weaken sandbox device restrictions to force it. Configuration/native application tests do not prove a container build, volume persistence, reboot or Ubuntu installation. Run those gates on a suitable staging host. Only loopback web diagnostics should be published; database and worker ports stay private.
