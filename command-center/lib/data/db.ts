import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type { Db };

/** Versioned migrations. Append only; never edit a shipped migration. */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "initial schema (spec section 9)",
    sql: `
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL CHECK (stage IN ('Idea','Researching','Proposal','Approved','Building','Live','Killed')),
  owning_lead_bot TEXT NOT NULL,
  risk_rating TEXT CHECK (risk_rating IN ('G','A','R')),
  risk_note TEXT,
  startup_cost_cad REAL CHECK (startup_cost_cad IS NULL OR startup_cost_cad >= 0),
  payback_weeks INTEGER CHECK (payback_weeks IS NULL OR payback_weeks >= 0),
  sales_per_week_needed INTEGER CHECK (sales_per_week_needed IS NULL OR sales_per_week_needed >= 0),
  payback_na_reason TEXT,
  next_step TEXT,
  kill_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE stage_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  by_bot TEXT NOT NULL,
  decision_id INTEGER REFERENCES decisions(id),
  at TEXT NOT NULL
);
CREATE INDEX idx_stage_changes_idea ON stage_changes(idea_id, id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('owner','bot')),
  actor_name TEXT NOT NULL,
  label TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id, id);

CREATE TABLE updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot TEXT NOT NULL,
  team TEXT NOT NULL,
  text TEXT NOT NULL,
  references_update_id INTEGER REFERENCES updates(id),
  at TEXT NOT NULL
);
CREATE INDEX idx_updates_at ON updates(at);
CREATE TABLE update_ideas (
  update_id INTEGER NOT NULL REFERENCES updates(id),
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  PRIMARY KEY (update_id, idea_id)
);

CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('Spend','Publish','Sign-up','Release','Other')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  amount_cad REAL,
  idea_id TEXT REFERENCES ideas(id),
  requested_by TEXT NOT NULL,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Withdrawn')),
  owner_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_decisions_status ON decisions(status);
CREATE TABLE decision_links (
  decision_id INTEGER NOT NULL REFERENCES decisions(id),
  url TEXT NOT NULL,
  label TEXT
);

CREATE TABLE proposals (
  idea_id TEXT PRIMARY KEY REFERENCES ideas(id),
  created_at TEXT NOT NULL
);
CREATE TABLE proposal_versions (
  idea_id TEXT NOT NULL REFERENCES proposals(idea_id),
  version INTEGER NOT NULL,
  body_md TEXT NOT NULL,
  author_bot TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (idea_id, version)
);

CREATE TABLE demos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  title TEXT NOT NULL
);
CREATE TABLE demo_screens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  demo_id INTEGER NOT NULL REFERENCES demos(id),
  position INTEGER NOT NULL,
  asset_url_or_embed TEXT NOT NULL,
  caption TEXT
);

CREATE TABLE bot_credentials (
  bot_name TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  token_hash TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Owner sessions of use, for BR-03 "since my last visit". Auth (Run B) can reuse or replace.
CREATE TABLE owner_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
];

export function migrate(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    })();
  }
}

/** Open (and migrate) a database. Use ":memory:" in tests. */
export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function defaultDbPath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH ?? "data/command-center.db");
}

const g = globalThis as unknown as { __ccDb?: Db };
/** Process-wide connection (survives Next.js dev hot reloads). */
export function getDb(): Db {
  return (g.__ccDb ??= openDb(defaultDbPath()));
}
