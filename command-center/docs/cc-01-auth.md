# CC-01 Owner login: design and security decisions

Spec: `docs/user-stories-v1.1.md` CC-01, BR-01, BR-02, BR-18, BR-19. Additions (a) to (f) are from ArchitectBot.

## Code map
| Piece | File |
|---|---|
| Auth logic (no Next.js imports, injected clock) | `lib/auth/service.ts` |
| Storage (single account row, sessions, recovery codes, throttle) | `lib/data/owner-auth.ts`, migration v2 in `lib/data/db.ts` |
| Guards for pages, actions and routes | `lib/auth/index.ts` (`requireOwner`, `requireOwnerAction`, `withOwnerApi`) |
| Early filter: Origin check, redirect to login, `no-store` | `proxy.ts` |
| Cookie, Origin, IP and background-request helpers | `lib/auth/http.ts` |
| TOTP (RFC 6238), recovery codes, argon2id | `lib/auth/totp.ts`, `lib/auth/recovery.ts`, `lib/auth/password.ts` |
| Host admin commands (AC7) | `scripts/admin-*.ts` -> `lib/auth/admin.ts` |
| One shared render function (BR-18) | `lib/sanitize.ts` `renderSafe()` |

## Decisions
- **Sign-in** is one form: username + password + (TOTP code or recovery code). Every wrong factor gives "Sign-in failed" (AC3). Codes are consumed only when all factors are right.
- **2FA** (AC3a, BR-19): password-only works only with `CC_ALLOW_PASSWORD_ONLY=1` on a local run; `CC_HOSTED=1` (or `VERCEL=1`) ignores that flag. Without 2FA enrolled, a correct password gives a 30-minute session that can only reach `/enroll`. Secret and QR code are generated on the server; nothing is sent elsewhere.
- **TOTP replay (c):** `owner_account.totp_last_step` stores the last accepted 30 s step. A code is accepted only for a later step, updated atomically (`advanceTotpStep`), so a code cannot be reused, even concurrently or after a restart. Skew is ±1 step.
- **Recovery codes (d, AC3b):** 10 codes, each 10 RFC 4648 base32 characters (50 bits) shown as `xxxxx-xxxxx`. Only argon2id hashes are stored (m=19 MiB, t=2, p=1). Each works once. Regenerating needs the password and a current TOTP code, and invalidates the old set.
- **Throttling (AC4):** 5 failures from one IP within 15 minutes block that IP for 15 minutes from the latest failure. Password, TOTP, recovery and enrolment failures share the counter. Attempts are reserved before checking, so parallel requests cannot exceed the limit. There is also an account-wide backoff (1 s doubling, capped at 60 s) against IP rotation. There is no hard account lockout, so an attacker cannot lock the Owner out. `npm run admin:unlock` clears both.
- **Sessions (AC5, AC5a):** a random 32-byte id; only its SHA-256 is stored. 12 h idle, 7 days absolute (then full re-login with 2FA). The id rotates on every sign-in and on enrolment. A password reset ends every session.
- **Idle timer and background traffic (a):** only Owner activity slides the idle window. Requests with `X-CC-Background: 1`, `Accept: text/event-stream` (SSE) or prefetch headers are validated but never extend it. `/api/session` is a background endpoint (`withOwnerApi(..., { background: true })`). Pollers and SSE added later (CC-60) must use one of these.
- **Cookie (b):** only `__Host-cc_session`, set with `HttpOnly; Secure; SameSite=Strict; Path=/` and no Domain. Browsers treat `http://localhost` as a secure context, so this also works for local development (Chrome, Firefox, Edge). Safari may not keep Secure cookies over plain-http localhost; use one of the others locally or serve over https.
- **CSRF / Origin (e):** every non-GET/HEAD/OPTIONS request must send an `Origin` matching the host (or `CC_ALLOWED_ORIGINS`). A failure returns **403** with no data: in `proxy.ts` (pages, server actions, API), in `withOwnerApi` and in `/logout`.
- **Sign out (AC6):** `POST /logout` deletes the server session, expires the cookie and sends `Clear-Site-Data: "cache", "storage"`. Every response is `Cache-Control: no-store`, so Back shows no data.
- **Expired session mid-action:** actions return `{ reauth: true }` and save nothing. The form keeps its input in sessionStorage across the trip to `/login` (`lib/client/draft.ts`).
- **BR-01:** `owner_account` has `CHECK (id = 1)`, there is no sign-up route, and accounts are created only by `npm run admin:set-password` on the host.
- **BR-02:** owner auth never reads `bot_credentials`; `Authorization` headers are ignored for UI sessions.
- **Raw storage, safe output (f, BR-18):** the data layer stores text exactly as posted. All output goes through `renderSafe(md, { mode: "block" | "inline" | "plain" })`. `SafeMarkdown` turns its sanitized tree into React elements and `toPlainText` reads its text. No `dangerouslySetInnerHTML` (checked by `tests/sanitize.test.tsx`).

## Tests
`tests/auth-config.test.ts`, `tests/auth-crypto.test.ts`, `tests/auth-service.test.ts`, `tests/auth-http.test.ts`, `tests/auth-actions.test.ts`, `tests/route-protection.test.ts`, `tests/sanitize.test.tsx`.
