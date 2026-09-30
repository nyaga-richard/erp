# Next.js host adaptation

The new execution specification explicitly requires Next.js. Reuse the current React workspace and its tested business screens; replace only Vite's hosting/bootstrap with Next.js App Router. No accounting/authentication rewrite. The browser still fetches relative /api/v1 routes; server-side rewrites proxy to the private Nest service. Runtime session state stays client-side; neither password nor memory session is serialized into server HTML. A client-only dynamic boundary is necessary because the existing workspace uses browser storage/crypto during initialization.

Development listens on 0.0.0.0:5173, preserving Arena preview links and regression scripts. Allowed development origins are the preview host family and the local cross-site test origins, not permissive API CORS. Production uses a non-root standalone Node image and a nonce-based CSP with frame-ancestors none. Production authentication remains HttpOnly-cookie-only; the Nest startup guard still forbids preview memory transport.

Verification gates: TypeScript/build; production server HTML and API proxy smoke test; all existing browser suites against the Next host; both cookie-independent development and cookie-only authentication regressions. A successful Next build is not evidence that Docker or the unreleased operational ERP is complete.
