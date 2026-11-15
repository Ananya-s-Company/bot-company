import { z } from "zod";
import { DomainError, iso, type Ctx } from "./ctx";
import { write } from "./events";
import { DECISION_TYPES, type Decision, type DecisionLink, type DecisionStatus } from "./types";

const createSchema = z
  .object({
    type: z.enum(DECISION_TYPES),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(4000),
    amount_cad: z.number().finite().nullable().optional(),
    idea_id: z.string().nullable().optional(),
    requested_by: z.string().trim().min(1),
    deadline: z.string().nullable().optional(),
    links: z.array(z.object({ url: z.string().url(), label: z.string().nullable().optional() })).optional(),
  })
  .refine((v) => v.type !== "Spend" || (v.amount_cad != null && v.amount_cad > 0), {
    message: "amount_cad is required and must be > 0 for Spend decisions",
    path: ["amount_cad"],
  });
export type CreateDecisionInput = z.input<typeof createSchema>;

interface Row extends Omit<Decision, "links"> {}

export function createDecisionsRepo(ctx: Ctx) {
  const { db } = ctx;

  const hydrate = (r: Row): Decision => ({
    ...r,
    links: db
      .prepare("SELECT url, label FROM decision_links WHERE decision_id = ?")
      .all(r.id) as DecisionLink[],
  });

  return {
    /** New requests always start Pending (CC-30 AC3). */
    create(input: CreateDecisionInput): Decision {
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        throw new DomainError("validation", issue.message, String(issue.path[0] ?? ""));
      }
      const v = parsed.data;
      if (v.idea_id && !db.prepare("SELECT 1 FROM ideas WHERE id = ?").get(v.idea_id)) {
        throw new DomainError("not_found", `Idea ${v.idea_id} not found`, "idea_id");
      }
      return write(db, ctx.now, (emit) => {
        const info = db
          .prepare(
            `INSERT INTO decisions (type,title,summary,amount_cad,idea_id,requested_by,deadline,status,created_at)
             VALUES (?,?,?,?,?,?,?, 'Pending', ?)`,
          )
          .run(v.type, v.title, v.summary, v.amount_cad ?? null, v.idea_id ?? null, v.requested_by, v.deadline ?? null, iso(ctx));
        const id = Number(info.lastInsertRowid);
        for (const l of v.links ?? []) {
          db.prepare("INSERT INTO decision_links (decision_id,url,label) VALUES (?,?,?)").run(id, l.url, l.label ?? null);
        }
        emit("decision", id, "created");
        return this.get(id)!;
      });
    },

    get(id: number): Decision | null {
      const r = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as Row | undefined;
      return r ? hydrate(r) : null;
    },

    list(status?: DecisionStatus): Decision[] {
      const rows = (
        status
          ? db.prepare("SELECT * FROM decisions WHERE status = ? ORDER BY id").all(status)
          : db.prepare("SELECT * FROM decisions ORDER BY id").all()
      ) as Row[];
      return rows.map(hydrate);
    },

    countPending(): number {
      return (db.prepare("SELECT COUNT(*) c FROM decisions WHERE status = 'Pending'").get() as { c: number }).c;
    },

    /** Latest Approved decision linked to the idea, optionally one specific id. */
    findApprovedForIdea(ideaId: string, decisionId?: number): Decision | null {
      const r = (
        decisionId != null
          ? db.prepare("SELECT * FROM decisions WHERE id = ? AND idea_id = ? AND status = 'Approved'").get(decisionId, ideaId)
          : db.prepare("SELECT * FROM decisions WHERE idea_id = ? AND status = 'Approved' ORDER BY decided_at DESC, id DESC LIMIT 1").get(ideaId)
      ) as Row | undefined;
      return r ? hydrate(r) : null;
    },

    /**
     * Owner decision (BR-11). Immutable once decided (CC-32 AC3). Recording an approval
     * never triggers any external action (BR-17).
     */
    decide(id: number, outcome: "Approved" | "Rejected", note: string | null): Decision {
      const trimmed = note?.trim() || null;
      if (outcome === "Rejected" && !trimmed) {
        throw new DomainError("validation", "A note is required when rejecting", "owner_note");
      }
      return write(db, ctx.now, (emit) => {
        const cur = this.get(id);
        if (!cur) throw new DomainError("not_found", `Decision ${id} not found`);
        if (cur.status !== "Pending") throw new DomainError("conflict", `Decision already ${cur.status}`);
        db.prepare("UPDATE decisions SET status = ?, owner_note = ?, decided_at = ? WHERE id = ?").run(outcome, trimmed, iso(ctx), id);
        emit("decision", id);
        return this.get(id)!;
      });
    },
  };
}
export type DecisionsRepo = ReturnType<typeof createDecisionsRepo>;
