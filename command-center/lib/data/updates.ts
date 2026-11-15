import { DomainError, iso, type Ctx } from "./ctx";
import { write } from "./events";
import type { Update } from "./types";

export const UPDATE_MAX_CHARS = 2000; // BR-09

interface Row {
  id: number;
  bot: string;
  team: string;
  text: string;
  references_update_id: number | null;
  at: string;
}

export function createUpdatesRepo(ctx: Ctx) {
  const { db } = ctx;
  const hydrate = (r: Row): Update => ({
    ...r,
    idea_ids: (db.prepare("SELECT idea_id FROM update_ideas WHERE update_id = ?").all(r.id) as { idea_id: string }[]).map(
      (x) => x.idea_id,
    ),
  });

  return {
    /** Append-only (BR-10): there is no edit or delete. Text is stored raw; sanitize on render (BR-18). */
    create(input: { bot: string; team: string; text: string; idea_ids?: string[]; references_update_id?: number | null }): {
      update: Update;
      warnings: string[];
    } {
      const text = input.text.trim();
      if (!text) throw new DomainError("validation", "Update text is required", "text");
      if (text.length > UPDATE_MAX_CHARS) {
        throw new DomainError("validation", `Update text is limited to ${UPDATE_MAX_CHARS} characters`, "text");
      }
      return write(db, ctx.now, (emit) => {
        const warnings: string[] = [];
        const ideaIds: string[] = [];
        for (const id of input.idea_ids ?? []) {
          if (db.prepare("SELECT 1 FROM ideas WHERE id = ?").get(id)) ideaIds.push(id);
          else warnings.push(`Idea ${id} not found; update accepted but not linked to it`);
        }
        const dup = db
          .prepare("SELECT * FROM updates WHERE bot = ? AND text = ? AND at >= ? ORDER BY id DESC LIMIT 1")
          .get(input.bot, text, new Date(ctx.now().getTime() - 60_000).toISOString()) as Row | undefined;
        if (dup) return { update: hydrate(dup), warnings: [...warnings, "Duplicate within 60 seconds ignored"] };
        const info = db
          .prepare("INSERT INTO updates (bot,team,text,references_update_id,at) VALUES (?,?,?,?,?)")
          .run(input.bot, input.team, text, input.references_update_id ?? null, iso(ctx));
        const id = Number(info.lastInsertRowid);
        for (const ideaId of ideaIds) db.prepare("INSERT INTO update_ideas (update_id,idea_id) VALUES (?,?)").run(id, ideaId);
        emit("update", id, "created");
        return { update: hydrate(db.prepare("SELECT * FROM updates WHERE id = ?").get(id) as Row), warnings };
      });
    },

    list(limit = 50): Update[] {
      return (db.prepare("SELECT * FROM updates ORDER BY at DESC, id DESC LIMIT ?").all(limit) as Row[]).map(hydrate);
    },

    /** Count updates strictly after `since`; null means count everything. */
    countSince(since: string | null): number {
      const row = since
        ? db.prepare("SELECT COUNT(*) c FROM updates WHERE at > ?").get(since)
        : db.prepare("SELECT COUNT(*) c FROM updates").get();
      return (row as { c: number }).c;
    },
  };
}
export type UpdatesRepo = ReturnType<typeof createUpdatesRepo>;
