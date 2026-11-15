import { describe, expect, it } from "vitest";
import { STAGES } from "../lib/data";
import { bot, makeData, owner } from "./helpers";

function setup() {
  const ctx = makeData();
  const idea = ctx.data.ideas.create({ name: "X", owning_lead_bot: "PMBot" });
  return { ...ctx, idea };
}
const approve = (data: ReturnType<typeof makeData>["data"], ideaId: string) => {
  const d = data.decisions.create({ type: "Other", title: "go", summary: "s", requested_by: "PMBot", idea_id: ideaId });
  return data.decisions.decide(d.id, "Approved", null);
};

describe("stage transition rules (CC-14, BR-07)", () => {
  it("uses the fixed stage order", () => {
    expect([...STAGES]).toEqual(["Idea", "Researching", "Proposal", "Approved", "Building", "Live", "Killed"]);
  });

  it("allows forward moves that skip stages, and records who/when/from/to", () => {
    const { data, idea } = setup();
    data.ideas.changeStage(idea.id, "Proposal", bot("PMBot"));
    const sc = data.ideas.history(idea.id).stageChanges[0]!;
    expect(sc).toMatchObject({ from_stage: "Idea", to_stage: "Proposal", by_bot: "PMBot", decision_id: null });
    expect(sc.at).toBe("2026-11-15T12:00:00.000Z");
  });

  it("adds the change to the updates feed", () => {
    const { data, idea } = setup();
    data.ideas.changeStage(idea.id, "Researching", bot("PMBot"));
    const u = data.updates.list()[0]!;
    expect(u.text).toContain("Idea → Researching");
    expect(u.idea_ids).toEqual([idea.id]);
  });

  it("rejects a move to the same stage", () => {
    const { data, idea } = setup();
    expect(() => data.ideas.changeStage(idea.id, "Idea", owner)).toThrow(/already/);
  });

  it.each(["Approved", "Building"] as const)("rejects a bot move into %s without an approved decision", (to) => {
    const { data, idea } = setup();
    expect(() => data.ideas.changeStage(idea.id, to, bot("PMBot"))).toThrow(/requires an Approved decision/);
    expect(data.ideas.get(idea.id)!.stage).toBe("Idea");
  });

  it("rejects when the linked decision is only Pending or Rejected", () => {
    const { data, idea } = setup();
    const d = data.decisions.create({ type: "Other", title: "t", summary: "s", requested_by: "PMBot", idea_id: idea.id });
    expect(() => data.ideas.changeStage(idea.id, "Approved", bot("PMBot"))).toThrow(/requires/);
    data.decisions.decide(d.id, "Rejected", "no");
    expect(() => data.ideas.changeStage(idea.id, "Approved", bot("PMBot"))).toThrow(/requires/);
  });

  it("rejects an approved decision linked to a different idea", () => {
    const { data, idea } = setup();
    const other = data.ideas.create({ name: "Y", owning_lead_bot: "PMBot" });
    approve(data, other.id);
    expect(() => data.ideas.changeStage(idea.id, "Approved", bot("PMBot"))).toThrow(/requires/);
  });

  it("accepts a move into Approved/Building with a linked approved decision and records it", () => {
    const { data, idea } = setup();
    const d = approve(data, idea.id);
    data.ideas.changeStage(idea.id, "Approved", bot("PMBot"));
    data.ideas.changeStage(idea.id, "Building", bot("PMBot"));
    expect(data.ideas.history(idea.id).stageChanges.map((s) => s.decision_id)).toEqual([d.id, d.id]);
  });

  it("requires an approved decision for Owner edits too, unless create-and-approve is requested", () => {
    const { data, idea } = setup();
    expect(() => data.ideas.changeStage(idea.id, "Approved", owner)).toThrow(/requires/);
    data.ideas.changeStage(idea.id, "Approved", owner, { createApproval: true });
    const approved = data.decisions.list("Approved");
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({ idea_id: idea.id, requested_by: "Ananya" });
    expect(data.ideas.get(idea.id)!.stage).toBe("Approved");
  });

  it("does not let a bot use createApproval", () => {
    const { data, idea } = setup();
    expect(() => data.ideas.changeStage(idea.id, "Approved", bot("PMBot"), { createApproval: true })).toThrow(/requires/);
    expect(data.decisions.list()).toHaveLength(0);
  });

  it("requires a kill reason for Killed and stores it", () => {
    const { data, idea } = setup();
    expect(() => data.ideas.changeStage(idea.id, "Killed", owner)).toThrow(/kill reason/);
    expect(() => data.ideas.changeStage(idea.id, "Killed", owner, { killReason: "   " })).toThrow(/kill reason/);
    const k = data.ideas.changeStage(idea.id, "Killed", bot("PMBot"), { killReason: "No demand" });
    expect(k).toMatchObject({ stage: "Killed", kill_reason: "No demand" });
  });

  it("lets the Owner revive a Killed idea and clears the kill reason", () => {
    const { data, idea } = setup();
    data.ideas.changeStage(idea.id, "Killed", owner, { killReason: "Wrong timing" });
    const r = data.ideas.changeStage(idea.id, "Researching", owner);
    expect(r).toMatchObject({ stage: "Researching", kill_reason: null });
    expect(data.ideas.history(idea.id).audit.filter((a) => a.field === "kill_reason")).toHaveLength(2);
  });

  it("blocks a bot revival unless a decision approved after the kill exists", () => {
    const { data, idea, advance } = setup();
    approve(data, idea.id); // approved before the kill
    advance(1000);
    data.ideas.changeStage(idea.id, "Killed", owner, { killReason: "x" });
    expect(() => data.ideas.changeStage(idea.id, "Researching", bot("PMBot"))).toThrow(/Reviving/);
    advance(1000);
    approve(data, idea.id);
    expect(data.ideas.changeStage(idea.id, "Researching", bot("PMBot")).stage).toBe("Researching");
  });

  it("owner edit can change stage and fields atomically with audit", () => {
    const { data, idea } = setup();
    data.ideas.ownerEdit(idea.id, owner, { next_step: "Draft" }, { to: "Researching" });
    const g = data.ideas.get(idea.id)!;
    expect(g).toMatchObject({ stage: "Researching", next_step: "Draft" });
    const fields = data.ideas.history(idea.id).audit.map((a) => a.field).sort();
    expect(fields).toEqual(["next_step", "stage"]);
  });
});
