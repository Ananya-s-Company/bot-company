import type { Data } from "./index";

/** The 7 seed ideas, exactly as the approved spec defines them (CC-11 AC1, AC4). */
export const SEED_IDEAS: { name: string; owner: "PMBot" | "MarketingStrategyBot" }[] = [
  { name: "PM/engineer templates", owner: "PMBot" },
  { name: "Newcomer-to-Canada toolkits", owner: "MarketingStrategyBot" },
  { name: "MBA case prep kits", owner: "PMBot" },
  { name: "Engineering/PM interview guides", owner: "PMBot" },
  { name: "PM micro-tool or browser extension", owner: "PMBot" },
  { name: "AI prompt packs", owner: "MarketingStrategyBot" },
  { name: "Newcomer content and affiliate hub", owner: "MarketingStrategyBot" },
];

/** Idempotent: re-running never duplicates (CC-11 AC3). Risk and financials stay null ("Pending"). */
export function seedIdeas(data: Data): number {
  let created = 0;
  for (const s of SEED_IDEAS) {
    if (data.ideas.getByName(s.name)) continue;
    data.ideas.create({ name: s.name, owning_lead_bot: s.owner, stage: "Idea" });
    created++;
  }
  return created;
}

/**
 * Minimal sample rows so Home (CC-02) shows something: one pending decision and two updates.
 * Placeholder content only; no real data. Runs once (tracked in meta).
 */
export function seedSamples(data: Data): boolean {
  const { db } = data.ctx;
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'seed_samples_v1'").get()) return false;
  const templates = data.ideas.getByName("PM/engineer templates");
  const prompts = data.ideas.getByName("AI prompt packs");
  data.updates.create({
    bot: "PMBot",
    team: "Product",
    text: "Sample update: scoped the first research questions for the template idea.",
    idea_ids: templates ? [templates.id] : [],
  });
  data.updates.create({
    bot: "MarketingStrategyBot",
    team: "Marketing",
    text: "Sample update: drafted an audience outline for the prompt packs idea.",
    idea_ids: prompts ? [prompts.id] : [],
  });
  data.decisions.create({
    type: "Other",
    title: "Sample: approve research scope for PM/engineer templates",
    summary: "Sample decision request so the Home summary has something to show. Safe to ignore.",
    idea_id: templates?.id ?? null,
    requested_by: "PMBot",
    deadline: new Date(data.ctx.now().getTime() + 3 * 86_400_000).toISOString(),
  });
  db.prepare("INSERT INTO meta (key, value) VALUES ('seed_samples_v1', ?)").run(data.ctx.now().toISOString());
  return true;
}
