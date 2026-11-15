import { describe, expect, it } from "vitest";
import { DomainError } from "../lib/data";
import { MIGRATIONS, migrate, openDb } from "../lib/data/db";
import { onChange, type ChangeEvent } from "../lib/data/events";
import { SEED_IDEAS, seedIdeas, seedSamples } from "../lib/data/seed";
import { bot, makeData, owner } from "./helpers";

describe("migrations", () => {
  it("creates the full section 9 schema and is re-runnable", () => {
    const db = openDb(":memory:");
    migrate(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ["ideas", "stage_changes", "updates", "decisions", "proposals", "proposal_versions", "demos", "demo_screens", "bot_credentials", "audit_log"]) {
      expect(tables).toContain(t);
    }
    expect((db.prepare("SELECT COUNT(*) c FROM schema_migrations").get() as { c: number }).c).toBe(MIGRATIONS.length);
  });
});

describe("seed", () => {
  it("creates exactly the 7 ideas with spec owners, Idea stage, and Pending fields", () => {
    const { data } = makeData();
    expect(seedIdeas(data)).toBe(7);
    const ideas = data.ideas.list();
    expect(ideas).toHaveLength(7);
    for (const s of SEED_IDEAS) {
      const i = data.ideas.getByName(s.name)!;
      expect(i.owning_lead_bot).toBe(s.owner);
      expect(i.stage).toBe("Idea");
      expect(i.risk_rating).toBeNull();
      expect(i.startup_cost_cad).toBeNull();
      expect(i.payback_weeks).toBeNull();
      expect(i.sales_per_week_needed).toBeNull();
    }
    expect(data.ideas.getByName("MBA case prep kits")!.owning_lead_bot).toBe("PMBot");
    expect(data.ideas.getByName("AI prompt packs")!.owning_lead_bot).toBe("MarketingStrategyBot");
  });

  it("is idempotent", () => {
    const { data } = makeData();
    seedIdeas(data);
    expect(seedIdeas(data)).toBe(0);
    expect(seedSamples(data)).toBe(true);
    expect(seedSamples(data)).toBe(false);
    expect(data.ideas.list()).toHaveLength(7);
    expect(data.decisions.countPending()).toBe(1);
  });
});

describe("ideas repository", () => {
  it("enforces BR-06 value rules", () => {
    const { data } = makeData();
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
    expect(() => data.ideas.updateFields(i.id, { startup_cost_cad: -1 }, owner)).toThrow(DomainError);
    expect(() => data.ideas.updateFields(i.id, { payback_weeks: -2 }, owner)).toThrow(DomainError);
    expect(() => data.ideas.updateFields(i.id, { payback_weeks: 1.5 }, owner)).toThrow(DomainError);
    const ok = data.ideas.updateFields(i.id, { startup_cost_cad: 45, payback_weeks: null, sales_per_week_needed: 3 }, owner);
    expect(ok.startup_cost_cad).toBe(45);
  });

  it("restricts bot writes by ownership (BR-04, BR-05) but not the Owner", () => {
    const { data } = makeData();
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
    expect(() => data.ideas.updateFields(i.id, { risk_rating: "R" }, bot("PMBot"))).toThrow(/may not edit/);
    expect(() => data.ideas.updateFields(i.id, { startup_cost_cad: 10 }, bot("RiskBot"))).toThrow(/may not edit/);
    expect(data.ideas.updateFields(i.id, { risk_rating: "R" }, bot("RiskBot")).risk_rating).toBe("R");
    expect(data.ideas.updateFields(i.id, { startup_cost_cad: 10 }, bot("FinancialsBot")).startup_cost_cad).toBe(10);
    expect(data.ideas.updateFields(i.id, { risk_rating: "G" }, owner).risk_rating).toBe("G");
  });

  it("stores timestamps as UTC ISO strings (BR-14)", () => {
    const { data } = makeData();
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
    expect(i.created_at).toBe("2026-11-15T12:00:00.000Z");
  });
});

describe("audit logging (CC-16)", () => {
  it("records old value, new value, time and 'edited by Ananya' for owner edits", () => {
    const { data, advance } = makeData();
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
    advance(60_000);
    data.ideas.ownerEdit(i.id, owner, { next_step: "Call suppliers", startup_cost_cad: 12.5 });
    const { audit } = data.ideas.history(i.id);
    const next = audit.find((a) => a.field === "next_step")!;
    expect(next).toMatchObject({ old_value: null, new_value: "Call suppliers", label: "edited by Ananya", actor_kind: "owner", at: "2026-11-15T12:01:00.000Z" });
    expect(audit.find((a) => a.field === "startup_cost_cad")!.new_value).toBe("12.5");
  });

  it("shows the owner label until the next (bot) change, and keeps risk history", () => {
    const { data } = makeData();
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
    data.ideas.updateFields(i.id, { risk_rating: "A" }, bot("RiskBot"));
    data.ideas.ownerEdit(i.id, owner, { risk_rating: "R" });
    let m = data.ideas.fieldMeta(i.id).risk_rating!;
    expect(m.label).toBe("edited by Ananya");
    expect(m.old_value).toBe("A");
    expect(m.new_value).toBe("R");
    data.ideas.updateFields(i.id, { risk_rating: "G" }, bot("RiskBot"));
    m = data.ideas.fieldMeta(i.id).risk_rating!;
    expect(m.actor_kind).toBe("bot");
  });

  it("does not audit no-op edits", () => {
    const { data } = makeData();
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot", next_step: "a" });
    data.ideas.ownerEdit(i.id, owner, { next_step: "a" });
    expect(data.ideas.history(i.id).audit).toHaveLength(0);
  });

  it("rolls back everything when an owner edit fails part-way", () => {
    const { data } = makeData();
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
    expect(() => data.ideas.ownerEdit(i.id, owner, { next_step: "b" }, { to: "Approved" })).toThrow(DomainError);
    expect(data.ideas.get(i.id)!.next_step).toBeNull();
    expect(data.ideas.history(i.id).audit).toHaveLength(0);
  });
});

describe("change events", () => {
  it("emits after commit and not on failure", () => {
    const { data } = makeData();
    const events: ChangeEvent[] = [];
    const off = onChange((e) => events.push(e));
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
    expect(events.map((e) => e.entity)).toContain("idea");
    events.length = 0;
    expect(() => data.ideas.updateFields(i.id, { startup_cost_cad: -5 }, owner)).toThrow();
    expect(() => data.ideas.changeStage(i.id, "Approved", owner)).toThrow();
    expect(events).toHaveLength(0);
    data.ideas.changeStage(i.id, "Researching", owner);
    expect(events.map((e) => e.entity).sort()).toEqual(["idea", "stage_change", "update"]);
    off();
  });
});

describe("updates, decisions, proposals, credentials", () => {
  it("de-duplicates identical updates within 60s and warns on unknown ideas (CC-22)", () => {
    const { data, advance } = makeData();
    const a = data.updates.create({ bot: "PMBot", team: "Product", text: "hi", idea_ids: ["nope"] });
    expect(a.warnings[0]).toMatch(/not found/);
    expect(a.update.idea_ids).toEqual([]);
    data.updates.create({ bot: "PMBot", team: "Product", text: "hi" });
    expect(data.updates.list()).toHaveLength(1);
    advance(61_000);
    data.updates.create({ bot: "PMBot", team: "Product", text: "hi" });
    expect(data.updates.list()).toHaveLength(2);
    expect(() => data.updates.create({ bot: "PMBot", team: "Product", text: "x".repeat(2001) })).toThrow(DomainError);
  });

  it("validates Spend amount, starts Pending, and decisions are immutable", () => {
    const { data } = makeData();
    expect(() => data.decisions.create({ type: "Spend", title: "t", summary: "s", requested_by: "PMBot" })).toThrow(/amount/);
    expect(() => data.decisions.create({ type: "Spend", title: "t", summary: "s", requested_by: "PMBot", amount_cad: 0 })).toThrow(/amount/);
    const d = data.decisions.create({ type: "Other", title: "t", summary: "s", requested_by: "PMBot" });
    expect(d.status).toBe("Pending");
    expect(() => data.decisions.decide(d.id, "Rejected", " ")).toThrow(/note is required/);
    expect(data.decisions.decide(d.id, "Approved", null).status).toBe("Approved");
    expect(() => data.decisions.decide(d.id, "Rejected", "changed mind")).toThrow(/already/);
  });

  it("versions proposals and manages credentials independently", () => {
    const { data } = makeData();
    const i = data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
    expect(data.proposals.addVersion(i.id, "# v1", "PMBot").version).toBe(1);
    expect(data.proposals.addVersion(i.id, "# v2", "PMBot").version).toBe(2);
    expect(data.proposals.latest(i.id)!.body_md).toBe("# v2");
    data.credentials.register("A");
    data.credentials.register("B");
    data.credentials.revoke("A");
    expect(data.credentials.list().map((c) => c.status)).toEqual(["revoked", "active"]);
  });
});

describe("home summary (CC-02, BR-03)", () => {
  it("counts stages, pending decisions, red ideas and updates since last visit", () => {
    const { data, advance } = makeData();
    seedIdeas(data);
    seedSamples(data);
    let s = data.homeSummary();
    expect(s.totalIdeas).toBe(7);
    expect(s.stageCounts.Idea).toBe(7);
    expect(s.pendingDecisions).toBe(1);
    expect(s.redIdeas).toBe(0);
    expect(s.updatesSinceLastVisit).toBe(2); // no previous visit: everything is new
    data.visits.touch(); // visit 1
    advance(60 * 60 * 1000); // idle > 30 min: next load is a new visit
    data.updates.create({ bot: "PMBot", team: "Product", text: "fresh" });
    const id = data.ideas.getByName("MBA case prep kits")!.id;
    data.ideas.updateFields(id, { risk_rating: "R" }, bot("RiskBot"));
    s = data.homeSummary();
    expect(s.updatesSinceLastVisit).toBe(1);
    expect(s.redIdeas).toBe(1);
    data.visits.touch(); // visit 2 begins
    expect(data.homeSummary().updatesSinceLastVisit).toBe(1); // reload inside visit 2 is stable
  });
});
