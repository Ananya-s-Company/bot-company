import { DomainError, iso, type Ctx } from "./ctx";
import { write } from "./events";
import type { BotCredential } from "./types";

// Metadata only in this run. Token issuing/verification arrives with the E7 bot API (Run C);
// token_hash is reserved for it. Raw secrets are never stored.
export function createCredentialsRepo(ctx: Ctx) {
  const { db } = ctx;
  const cols = "bot_name, status, created_at, revoked_at";
  return {
    register(botName: string, tokenHash: string | null = null): BotCredential {
      return write(db, ctx.now, (emit) => {
        db.prepare("INSERT INTO bot_credentials (bot_name,status,token_hash,created_at) VALUES (?, 'active', ?, ?)").run(botName, tokenHash, iso(ctx));
        emit("credential", botName, "created");
        return db.prepare(`SELECT ${cols} FROM bot_credentials WHERE bot_name = ?`).get(botName) as BotCredential;
      });
    },
    /** Revoke one bot without touching others (CC-71 AC1). */
    revoke(botName: string): BotCredential {
      return write(db, ctx.now, (emit) => {
        const r = db.prepare("UPDATE bot_credentials SET status='revoked', revoked_at=? WHERE bot_name=? AND status='active'").run(iso(ctx), botName);
        if (r.changes === 0) throw new DomainError("not_found", `No active credential for ${botName}`);
        emit("credential", botName);
        return db.prepare(`SELECT ${cols} FROM bot_credentials WHERE bot_name = ?`).get(botName) as BotCredential;
      });
    },
    list(): BotCredential[] {
      return db.prepare(`SELECT ${cols} FROM bot_credentials ORDER BY bot_name`).all() as BotCredential[];
    },
  };
}
