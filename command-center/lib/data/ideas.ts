import { z } from "zod";
import { DomainError, iso, type Ctx } from "./ctx";
import { write } from "./events";
import { createDecisionsRepo } from "./decisions";
import {
  GATED_STAGES,
  RISK_RATINGS,
  STAGES,
  type Actor,
  type AuditEntry,
  type FieldMeta,
  type Idea,
  type RiskRating,
  type Stage,
  type StageChange,
} from "./types";

/** Bots that hold exclusive bot-write rights on a field group (BR-04, BR-05). */
export const RISK_BOT = "RiskBot";
export const FINANCIALS_BOT = "FinancialsBot";
export const PM_BOT = "PMBot";

const RISK_FIELDS = ["risk_rating", "risk_note"] as const;
const FINANCIAL_FIELDS = ["startup_cost_cad", "payback_weeks", "sales_per_week_needed", "payback_na_reason"] as const;
const GENERAL_FIELDS = ["name", "owning_lead_bot", "next_step"] as const;
export const EDITABLE_FIELDS = [...GENERAL_FIELDS, ...RISK_FIELDS, ...FINANCIAL_FIELDS] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const optText = z.string().trim().max(2000).nullable().optional().transform((v) => (v ? v : null));

/** Field validation, including BR-06 (cost >= 0; payback and sales >= 0 or null) and BR-15 (CAD only). */
export const ideaPatchSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    owning_lead_bot: z.string().trim().min(1, "Owner is required").max(100),
    next_step: optText,
    risk_rating: z.enum(RISK_RATINGS).nullable(),
    risk_note: optText,
    startup_cost_cad: z
      .number()
      .finite()
      .min(0, "Startup cost must be 0 or more")
      .nullable()
      .transform((v) => (v == null ? null : Math.round(v * 100) / 100)),
    payback_weeks: z.number().int("Payback must be whole weeks").min(0, "Payback must be 0 or more").nullable(),
    sales_per_week_needed: z.number().int("Sales per week must be a whole number").min(0, "Sales per week must be 0 or more").nullable(),
    payback_na_reason: optText,
  })
  .partial()
  .strict();
export type IdeaPatch = z.input<typeof ideaPatchSchema>;

export interface StageChangeOptions {
  killReason?: string | null;
  /** Specific approved decision to cite for gated moves. */
  decisionId?: number;
  /** Owner only: create and approve a decision in the same action (CC-14 AC2). */
  createApproval?: boolean;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "idea";

const asText = (v: unknown): string | null => (v == null ? null : String(v));
const actorLabel = (a: Actor) => (a.kind === "owner" ? `edited by ${a.name}` : `posted by ${a.name}`);

export function createIdeasRepo(ctx: Ctx) {
  const { db } = ctx;
  const decisions = createDecisionsRepo(ctx);

  function audit(ideaId: string, field: string, oldV: unknown, newV: unknown, actor: Actor): void {
    db.prepare(
      `INSERT INTO audit_log (entity,entity_id,field,old_value,new_value,actor_kind,actor_name,label,at)
       VALUES ('idea',?,?,?,?,?,?,?,?)`,
    ).run(ideaId, field, asText(oldV), asText(newV), actor.kind, actor.name, actorLabel(actor), iso(ctx));
  }

  const repo = {
    get(id: string): Idea | null {
      return (db.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as Idea | undefined) ?? null;
    },

    getByName(name: string): Idea | null {
      return (db.prepare("SELECT * FROM ideas WHERE name = ?").get(name) as Idea | undefined) ?? null;
    },

    list(): Idea[] {
      return db.prepare("SELECT * FROM ideas ORDER BY updated_at DESC, name").all() as Idea[];
    },

    /** Create an idea (used by seed). Risk and financial fields start null, shown as "Pending". */
    create(input: { name: string; owning_lead_bot: string; stage?: Stage; next_step?: string | null }): Idea {
      const name = input.name.trim();
      if (!name) throw new DomainError("validation", "Name is required", "name");
      const stage = input.stage ?? "Idea";
      if (!STAGES.includes(stage)) throw new DomainError("validation", "Unknown stage", "stage");
      return write(db, ctx.now, (emit) => {
        let id = slug(name);
        for (let i = 2; db.prepare("SELECT 1 FROM ideas WHERE id = ?").get(id); i++) id = `${slug(name)}-${i}`;
        const t = iso(ctx);
        db.prepare(
          `INSERT INTO ideas (id,name,stage,owning_lead_bot,next_step,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
        ).run(id, name, stage, input.owning_lead_bot, input.next_step ?? null, t, t);
        emit("idea", id, "created");
        return repo.get(id)!;
      });
    },

    /**
     * Field edits. The Owner may edit anything (BR-20). Bots are limited by BR-04/05/12-style
     * ownership: risk fields RiskBot only, financial fields FinancialsBot only, other fields
     * the idea's owning lead bot or PMBot. Every changed field is audited with old/new values.
     */
    updateFields(id: string, rawPatch: IdeaPatch, actor: Actor): Idea {
      const parsedPatch = ideaPatchSchema.safeParse(rawPatch);
      if (!parsedPatch.success) {
        const issue = parsedPatch.error.issues[0]!;
        throw new DomainError("validation", issue.message, String(issue.path[0] ?? ""));
      }
      const patch = parsedPatch.data as Partial<Record<EditableField, unknown>>;
      return write(db, ctx.now, (emit) => {
        const cur = repo.get(id);
        if (!cur) throw new DomainError("not_found", `Idea ${id} not found`);
        if (actor.kind === "bot") {
          for (const f of Object.keys(patch) as EditableField[]) {
            if (!repo.botMayEdit(actor.name, cur, f)) {
              throw new DomainError("forbidden", `${actor.name} may not edit ${f}`, f);
            }
          }
        }
        const changed = (Object.keys(patch) as EditableField[]).filter((f) => patch[f] !== undefined && patch[f] !== cur[f]);
        if (changed.length === 0) return cur;
        if (changed.includes("name")) {
          const clash = db.prepare("SELECT 1 FROM ideas WHERE name = ? AND id <> ?").get(patch.name, id);
          if (clash) throw new DomainError("conflict", "Another idea already has that name", "name");
        }
        for (const f of changed) audit(id, f, cur[f], patch[f], actor);
        const sets = changed.map((f) => `${f} = @${f}`).join(", ");
        db.prepare(`UPDATE ideas SET ${sets}, updated_at = @updated_at WHERE id = @id`).run({
          ...Object.fromEntries(changed.map((f) => [f, patch[f] ?? null])),
          updated_at: iso(ctx),
          id,
        });
        emit("idea", id);
        return repo.get(id)!;
      });
    },

    botMayEdit(bot: string, idea: Idea, field: EditableField): boolean {
      if ((RISK_FIELDS as readonly string[]).includes(field)) return bot === RISK_BOT;
      if ((FINANCIAL_FIELDS as readonly string[]).includes(field)) return bot === FINANCIALS_BOT;
      return bot === idea.owning_lead_bot || bot === PM_BOT;
    },

    /**
     * Stage transition rules (CC-14, BR-07):
     *  - stages are a fixed list; forward moves may skip, except into Approved/Building
     *  - Approved/Building need a linked Approved decision (Owner may create+approve one in the same action)
     *  - Killed needs a kill reason
     *  - leaving Killed: Owner always; a bot only with an Approved decision linked to the idea decided after the kill
     * Writes a StageChange row, audit rows and a feed Update.
     */
    changeStage(id: string, to: Stage, actor: Actor, opts: StageChangeOptions = {}): Idea {
      if (!STAGES.includes(to)) throw new DomainError("validation", `Unknown stage ${String(to)}`, "stage");
      return write(db, ctx.now, (emit) => {
        const cur = repo.get(id);
        if (!cur) throw new DomainError("not_found", `Idea ${id} not found`);
        if (cur.stage === to) throw new DomainError("stage_rule", `Idea is already in ${to}`, "stage");

        const killReason = opts.killReason?.trim() || null;
        if (to === "Killed" && !killReason) {
          throw new DomainError("stage_rule", "A kill reason is required to move an idea to Killed", "kill_reason");
        }

        let decisionId: number | null = null;
        if (GATED_STAGES.includes(to)) {
          let d = decisions.findApprovedForIdea(id, opts.decisionId);
          if (!d && actor.kind === "owner" && opts.createApproval) {
            const created = decisions.create({
              type: "Other",
              title: `Move "${cur.name}" to ${to}`,
              summary: `Owner-initiated move from ${cur.stage} to ${to}.`,
              idea_id: id,
              requested_by: actor.name,
            });
            d = decisions.decide(created.id, "Approved", `Approved by ${actor.name} with the stage change.`);
          }
          if (!d) {
            throw new DomainError(
              "stage_rule",
              `Moving to ${to} requires an Approved decision linked to this idea`,
              "stage",
            );
          }
          decisionId = d.id;
        }

        if (cur.stage === "Killed" && actor.kind === "bot") {
          const killedAt = (
            db.prepare("SELECT at FROM stage_changes WHERE idea_id = ? AND to_stage = 'Killed' ORDER BY id DESC LIMIT 1").get(id) as
              | { at: string }
              | undefined
          )?.at;
          const d = decisions.findApprovedForIdea(id, opts.decisionId);
          if (!d || (killedAt && (d.decided_at ?? "") <= killedAt)) {
            throw new DomainError("stage_rule", "Reviving a Killed idea needs an Owner action or a newly approved decision", "stage");
          }
          decisionId = d.id;
        }

        const t = iso(ctx);
        db.prepare("INSERT INTO stage_changes (idea_id,from_stage,to_stage,by_bot,decision_id,at) VALUES (?,?,?,?,?,?)").run(
          id,
          cur.stage,
          to,
          actor.name,
          decisionId,
          t,
        );
        audit(id, "stage", cur.stage, to, actor);
        const newKill = to === "Killed" ? killReason : null;
        if (newKill !== cur.kill_reason) audit(id, "kill_reason", cur.kill_reason, newKill, actor);
        db.prepare("UPDATE ideas SET stage = ?, kill_reason = ?, updated_at = ? WHERE id = ?").run(to, newKill, t, id);
        // Stage changes appear in the updates feed (CC-14 AC1).
        const upd = db
          .prepare("INSERT INTO updates (bot,team,text,at) VALUES (?,?,?,?)")
          .run(actor.name, "Stage changes", `${cur.name}: ${cur.stage} → ${to}${newKill ? ` (${newKill})` : ""}`, t);
        db.prepare("INSERT INTO update_ideas (update_id,idea_id) VALUES (?,?)").run(Number(upd.lastInsertRowid), id);
        emit("stage_change", id, "created");
        emit("update", Number(upd.lastInsertRowid), "created");
        emit("idea", id);
        return repo.get(id)!;
      });
    },

    /** CC-16: Owner edits any field, including stage, in one audited action. */
    ownerEdit(
      id: string,
      owner: Actor & { kind: "owner" },
      patch: IdeaPatch,
      stage?: { to: Stage } & StageChangeOptions,
    ): Idea {
      return write(db, ctx.now, () => {
        const cur = repo.get(id);
        if (!cur) throw new DomainError("not_found", `Idea ${id} not found`);
        if (stage && stage.to !== cur.stage) repo.changeStage(id, stage.to, owner, stage);
        return repo.updateFields(id, patch, owner);
      });
    },

    history(id: string): { audit: AuditEntry[]; stageChanges: StageChange[] } {
      return {
        audit: db.prepare("SELECT * FROM audit_log WHERE entity = 'idea' AND entity_id = ? ORDER BY id DESC").all(id) as AuditEntry[],
        stageChanges: db.prepare("SELECT * FROM stage_changes WHERE idea_id = ? ORDER BY id DESC").all(id) as StageChange[],
      };
    },

    /**
     * Latest audit entry per field for the idea (drives "edited by Ananya" labels until the
     * next change, and the previous-risk display in CC-12 AC2).
     */
    fieldMeta(id: string): Record<string, FieldMeta> {
      const rows = db
        .prepare(
          `SELECT a.* FROM audit_log a
           WHERE a.entity = 'idea' AND a.entity_id = ?
             AND a.id = (SELECT MAX(id) FROM audit_log b WHERE b.entity='idea' AND b.entity_id = a.entity_id AND b.field = a.field)`,
        )
        .all(id) as AuditEntry[];
      return Object.fromEntries(
        rows.map((r) => [
          r.field,
          {
            field: r.field,
            label: r.label,
            actor_kind: r.actor_kind,
            actor_name: r.actor_name,
            old_value: r.old_value,
            new_value: r.new_value,
            at: r.at,
          } satisfies FieldMeta,
        ]),
      );
    },

    countByStage(): Record<Stage, number> {
      const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
      for (const r of db.prepare("SELECT stage, COUNT(*) c FROM ideas GROUP BY stage").all() as { stage: Stage; c: number }[]) {
        out[r.stage] = r.c;
      }
      return out;
    },

    countByRisk(rating: RiskRating): number {
      return (db.prepare("SELECT COUNT(*) c FROM ideas WHERE risk_rating = ?").get(rating) as { c: number }).c;
    },
  };
  return repo;
}
export type IdeasRepo = ReturnType<typeof createIdeasRepo>;
