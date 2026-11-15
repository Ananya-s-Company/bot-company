# Command Center

Private dashboard for the company's ideas, decisions and updates. Spec: `docs/user-stories-v1.1.md`.

Status: scaffold, E1 ideas board (CC-10 to CC-16), the CC-02 Home summary (Run A) and CC-01 Owner login with password + TOTP 2FA (Run B). The bot API (E7, Run C) is not built yet. Before any hosted deployment set `CC_HOSTED=1` and enrol 2FA (BR-19); see `docs/cc-01-auth.md`.

## Run it

```bash
cd command-center
npm install
cp .env.example .env.local   # optional; defaults work
npm run seed                 # creates data/command-center.db, 7 ideas + a few sample rows
npm run admin:set-password   # creates the single Owner account (prompts for username + password)
npm run dev
# open http://localhost:3000, sign in, scan the QR code with an authenticator app, save the recovery codes
```

Other scripts: `npm test`, `npm run build`, `npm run typecheck`. `npm run seed` is safe to re-run.
Host-only admin commands (AC7, no email reset): `npm run admin:set-password`, `npm run admin:reset-2fa`, `npm run admin:unlock`.

## Architecture

- **Stack:** Next.js (App Router), TypeScript strict, Tailwind CSS, better-sqlite3, zod, vitest.
- **Repository layer (`lib/data/`):** the only code that touches storage. `db.ts` holds the connection and versioned migrations (the full spec section 9 schema); there is one module per entity (`ideas`, `decisions`, `updates`, `proposals`, `demos`, `credentials`, `visits`) and `types.ts` holds the domain types. UI and route handlers import from `@/lib/data` only, so storage can later move to Supabase by reimplementing `createData()`.
- **Change events (`lib/data/events.ts`):** every write runs in a transaction and emits a `ChangeEvent` after commit (`onChange(listener)`). The real-time epic plugs in here.
- **Rules live in the repository:** stage transitions (CC-14), bot field ownership (BR-04/05), value validation (BR-06) and audit logging (CC-16) are enforced in `lib/data`, so the future bot API gets them for free.
- **Design tokens:** all colors, fonts, spacing and radii are in `lib/design/tokens.ts`, wired into Tailwind through `tailwind.config.ts`.
- **Safety:** text is stored raw and sanitized on output by one shared render function, `renderSafe()` in `lib/sanitize.ts`; `components/SafeMarkdown.tsx` and `toPlainText()` are thin adapters over it (no raw HTML, no images; BR-18). The site makes no outbound calls and triggers no external action (BR-17).
- **Time and money:** timestamps are UTC ISO strings and display in America/Toronto with a zone label (BR-14); currency is CAD only (BR-15).
- **Auth (CC-01):** `lib/auth/service.ts` (framework-free logic), `lib/auth/index.ts` (guards used by every page, action and route), `proxy.ts` (early filter: Origin check, redirect to `/login`, `no-store`). Details and security decisions: `docs/cc-01-auth.md`.

## Tests

`npm test` runs vitest against in-memory SQLite (`tests/`): repository, stage-transition rules, audit logging, change events, seed, Home summary, formatting, filters, sanitizing, and CC-01 auth (crypto, service, HTTP/proxy, server actions, route-protection scan).

## Seed data

Only the 7 ideas from the spec (CC-11) plus clearly labelled "Sample" rows (2 updates, 1 pending decision) so the Home summary shows something. No real or personal data.
