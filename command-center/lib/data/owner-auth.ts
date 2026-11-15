import type { Db } from "./db";

// Storage for Owner authentication (CC-01). Only lib/auth uses this. It is deliberately
// not part of the createData() facade and never reads bot_credentials (BR-02).

export interface OwnerAccountRow {
  id: 1;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  totp_pending_secret: string | null;
  totp_enrolled_at: string | null;
  totp_last_step: number | null;
  password_changed_at: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id_hash: string;
  kind: "full" | "enrol";
  mfa: 0 | 1;
  created_at: string;
  last_seen_at: string;
}

export interface BackoffRow {
  consecutive_failures: number;
  last_failure_at: string | null;
}

export function createOwnerAuthRepo(db: Db) {
  return {
    tx<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    // ---- account (BR-01: single row) ----
    getAccount(): OwnerAccountRow | undefined {
      return db.prepare("SELECT * FROM owner_account WHERE id = 1").get() as OwnerAccountRow | undefined;
    },
    upsertPassword(username: string, passwordHash: string, at: string): void {
      db.prepare(
        `INSERT INTO owner_account (id, username, password_hash, password_changed_at, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash,
           password_changed_at = excluded.password_changed_at, updated_at = excluded.updated_at`,
      ).run(username, passwordHash, at, at, at);
    },
    /** Transparent rehash after a parameter change; not a password change. */
    updatePasswordHash(passwordHash: string, at: string): void {
      db.prepare("UPDATE owner_account SET password_hash = ?, updated_at = ? WHERE id = 1").run(passwordHash, at);
    },
    setPendingTotp(secret: string | null, at: string): void {
      db.prepare("UPDATE owner_account SET totp_pending_secret = ?, updated_at = ? WHERE id = 1").run(secret, at);
    },
    /** Promote the verified pending secret. Fails if it changed or 2FA is already on. */
    activateTotp(secret: string, step: number, at: string): boolean {
      return (
        db
          .prepare(
            `UPDATE owner_account SET totp_secret = ?, totp_pending_secret = NULL, totp_enrolled_at = ?, totp_last_step = ?, updated_at = ?
             WHERE id = 1 AND totp_pending_secret = ? AND totp_secret IS NULL`,
          )
          .run(secret, at, step, at, secret).changes === 1
      );
    },
    /** Replay guard: only moves forward, atomically. False if the step was already used. */
    advanceTotpStep(step: number): boolean {
      return (
        db
          .prepare("UPDATE owner_account SET totp_last_step = ? WHERE id = 1 AND (totp_last_step IS NULL OR totp_last_step < ?)")
          .run(step, step).changes === 1
      );
    },
    clearTotp(at: string): void {
      db.prepare(
        "UPDATE owner_account SET totp_secret = NULL, totp_pending_secret = NULL, totp_enrolled_at = NULL, totp_last_step = NULL, updated_at = ? WHERE id = 1",
      ).run(at);
      db.prepare("DELETE FROM owner_recovery_codes").run();
    },

    // ---- recovery codes ----
    /** Replaces the whole set: the previous codes stop working. */
    replaceRecoveryCodes(hashes: string[], at: string): void {
      db.prepare("DELETE FROM owner_recovery_codes").run();
      const ins = db.prepare("INSERT INTO owner_recovery_codes (code_hash, created_at) VALUES (?, ?)");
      for (const h of hashes) ins.run(h, at);
    },
    unusedRecoveryCodes(): { id: number; code_hash: string }[] {
      return db.prepare("SELECT id, code_hash FROM owner_recovery_codes WHERE used_at IS NULL ORDER BY id").all() as {
        id: number;
        code_hash: string;
      }[];
    },
    /** Single use: atomic, false if already used (or replaced). */
    consumeRecoveryCode(id: number, at: string): boolean {
      return db.prepare("UPDATE owner_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").run(at, id).changes === 1;
    },

    // ---- sessions ----
    insertSession(s: SessionRow): void {
      db.prepare("INSERT INTO owner_sessions (id_hash, kind, mfa, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
        s.id_hash,
        s.kind,
        s.mfa,
        s.created_at,
        s.last_seen_at,
      );
    },
    getSession(idHash: string): SessionRow | undefined {
      return db.prepare("SELECT * FROM owner_sessions WHERE id_hash = ?").get(idHash) as SessionRow | undefined;
    },
    touchSession(idHash: string, at: string): void {
      db.prepare("UPDATE owner_sessions SET last_seen_at = ? WHERE id_hash = ?").run(at, idHash);
    },
    deleteSession(idHash: string): void {
      db.prepare("DELETE FROM owner_sessions WHERE id_hash = ?").run(idHash);
    },
    deleteAllSessions(): number {
      return db.prepare("DELETE FROM owner_sessions").run().changes;
    },
    deleteSessionsBefore(idleCutoff: string, absoluteCutoff: string): void {
      db.prepare("DELETE FROM owner_sessions WHERE last_seen_at <= ? OR created_at <= ?").run(idleCutoff, absoluteCutoff);
    },
    countSessions(): number {
      return (db.prepare("SELECT COUNT(*) AS c FROM owner_sessions").get() as { c: number }).c;
    },

    // ---- throttling ----
    insertAttempt(ip: string, at: string): number {
      return Number(db.prepare("INSERT INTO auth_attempts (ip, at, outcome) VALUES (?, ?, 'pending')").run(ip, at).lastInsertRowid);
    },
    finishAttempt(id: number, outcome: "failed" | "success"): void {
      db.prepare("UPDATE auth_attempts SET outcome = ? WHERE id = ?").run(outcome, id);
    },
    /** Pending and failed attempts from `ip` strictly after `since`, oldest first. */
    failuresSince(ip: string, since: string): string[] {
      return (
        db
          .prepare("SELECT at FROM auth_attempts WHERE ip = ? AND at > ? AND outcome IN ('pending','failed') ORDER BY at")
          .all(ip, since) as { at: string }[]
      ).map((r) => r.at);
    },
    clearFailuresForIp(ip: string): void {
      db.prepare("DELETE FROM auth_attempts WHERE ip = ? AND outcome IN ('pending','failed')").run(ip);
    },
    pruneAttemptsBefore(at: string): void {
      db.prepare("DELETE FROM auth_attempts WHERE at < ?").run(at);
    },
    getBackoff(): BackoffRow {
      return db.prepare("SELECT consecutive_failures, last_failure_at FROM auth_backoff WHERE id = 1").get() as BackoffRow;
    },
    setBackoff(consecutive: number, lastFailureAt: string | null): void {
      db.prepare("UPDATE auth_backoff SET consecutive_failures = ?, last_failure_at = ? WHERE id = 1").run(consecutive, lastFailureAt);
    },
    /** admin:unlock — clears every IP throttle and the account backoff. */
    clearThrottles(): number {
      const n = db.prepare("DELETE FROM auth_attempts").run().changes;
      db.prepare("UPDATE auth_backoff SET consecutive_failures = 0, last_failure_at = NULL WHERE id = 1").run();
      return n;
    },
  };
}
export type OwnerAuthRepo = ReturnType<typeof createOwnerAuthRepo>;
