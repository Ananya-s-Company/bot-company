import { iso, type Ctx } from "./ctx";
import { write } from "./events";

/** A gap longer than this between page loads starts a new "visit" (assumption; see README). */
export const VISIT_GAP_MS = 30 * 60 * 1000;

interface Visit {
  id: number;
  started_at: string;
  last_activity_at: string;
}

/**
 * BR-03: "since my last visit" = since the previous session's last activity.
 * Run B (auth) may replace this with real login sessions.
 */
export function createVisitsRepo(ctx: Ctx) {
  const { db } = ctx;
  const latest = () => db.prepare("SELECT * FROM owner_visits ORDER BY id DESC LIMIT 1").get() as Visit | undefined;
  return {
    /** Last activity of the previous visit, or null if there was none. Read-only. */
    previousVisitEnd(): string | null {
      const cur = latest();
      if (!cur) return null;
      if (ctx.now().getTime() - Date.parse(cur.last_activity_at) <= VISIT_GAP_MS) {
        // Still inside the current visit: the "previous" one is the one before it.
        const prev = db.prepare("SELECT last_activity_at FROM owner_visits WHERE id < ? ORDER BY id DESC LIMIT 1").get(cur.id) as
          | { last_activity_at: string }
          | undefined;
        return prev?.last_activity_at ?? null;
      }
      return cur.last_activity_at;
    },
    /** Record activity now; starts a new visit after an idle gap. */
    touch(): void {
      write(db, ctx.now, (emit) => {
        const cur = latest();
        const t = iso(ctx);
        if (cur && ctx.now().getTime() - Date.parse(cur.last_activity_at) <= VISIT_GAP_MS) {
          db.prepare("UPDATE owner_visits SET last_activity_at = ? WHERE id = ?").run(t, cur.id);
        } else {
          db.prepare("INSERT INTO owner_visits (started_at,last_activity_at) VALUES (?,?)").run(t, t);
        }
        emit("visit", cur?.id ?? 0);
      });
    },
  };
}
