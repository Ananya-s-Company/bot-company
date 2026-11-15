# Command Center

Private dashboard for the company's ideas, decisions and updates. Spec: `docs/user-stories-v1.1.md`.

Run A status: scaffold, E1 ideas board (CC-10 to CC-16) and the CC-02 Home summary. Login (CC-01, Run B) and the bot API (E7, Run C) are not built yet, so **run locally only**.

## Run it

```bash
cd command-center
npm install
cp .env.example .env.local   # optional; defaults work
npm run seed                 # creates data/command-center.db, 7 ideas + a few sample rows
npm run dev
# open http://localhost:3000
```

Other scripts: `npm test`, `npm run build`, `npm run typecheck`. `npm run seed` is safe to re-run.

## Architecture

- **Stack:** Next.js (App Router), TypeScript strict, Tailwind CSS, better-sqlite3, zod, vitest.
- **Repository layer (`lib/data/`):** the only code that touches storage. `db.ts` holds the connection and versioned migrations (the full spec section 9 schema); there is one module per entity (`ideas`, `decisions`, `updates`, `proposals`, `demos`, `credentials`, `visits`) and `types.ts` holds the domain types. UI and route handlers import from `@/lib/data` only, so storage can later move to Supabase by reimplementing `createData()`.
- **Change events (`lib/data/events.ts`):** every write runs in a transaction and emits a `ChangeEvent` after commit (`onChange(listener)`). The real-time epic plugs in here.
- **Rules live in the repository:** stage transitions (CC-14), bot field ownership (BR-04/05), value validation (BR-06) and audit logging (CC-16) are enforced in `lib/data`, so the future bot API gets them for free.
- **Design tokens:** all colors, fonts, spacing and radii are in `lib/design/tokens.ts`, wired into Tailwind through `tailwind.config.ts`.
- **Safety:** bot markdown renders only through `components/SafeMarkdown.tsx` (no raw HTML, sanitized, no images; BR-18). The site makes no outbound calls and triggers no external action (BR-17).
- **Time and money:** timestamps are UTC ISO strings and display in America/Toronto with a zone label (BR-14); currency is CAD only (BR-15).
- **Auth hook:** `middleware.ts` is a marked placeholder (currently allows everything) and `lib/auth/index.ts` is a stub. Run B implements them.

## Tests

`npm test` runs vitest against in-memory SQLite (`tests/`): repository, stage-transition rules, audit logging, change events, seed, Home summary, formatting, filters and markdown sanitizing.

## Seed data

Only the 7 ideas from the spec (CC-11) plus clearly labelled "Sample" rows (2 updates, 1 pending decision) so the Home summary shows something. No real or personal data.
