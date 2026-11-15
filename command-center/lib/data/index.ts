// Repository facade. UI and route handlers import from "@/lib/data" only.
// To swap storage (e.g. Supabase), reimplement createData() behind the same shapes.
import type { Ctx } from "./ctx";
import { getDb, type Db } from "./db";
import { createCredentialsRepo } from "./credentials";
import { createDecisionsRepo } from "./decisions";
import { createDemosRepo } from "./demos";
import { createIdeasRepo } from "./ideas";
import { createProposalsRepo } from "./proposals";
import { createUpdatesRepo } from "./updates";
import { createVisitsRepo } from "./visits";
import type { HomeSummary } from "./types";

export function createData(db: Db, now: () => Date = () => new Date()) {
  const ctx: Ctx = { db, now };
  const data = {
    ctx,
    ideas: createIdeasRepo(ctx),
    decisions: createDecisionsRepo(ctx),
    updates: createUpdatesRepo(ctx),
    proposals: createProposalsRepo(ctx),
    demos: createDemosRepo(ctx),
    credentials: createCredentialsRepo(ctx),
    visits: createVisitsRepo(ctx),
    /** CC-02 numbers. Reads only; call visits.touch() separately. */
    homeSummary(): HomeSummary {
      const stageCounts = data.ideas.countByStage();
      const lastVisitAt = data.visits.previousVisitEnd();
      return {
        stageCounts,
        totalIdeas: Object.values(stageCounts).reduce((a, b) => a + b, 0),
        pendingDecisions: data.decisions.countPending(),
        redIdeas: data.ideas.countByRisk("R"),
        updatesSinceLastVisit: data.updates.countSince(lastVisitAt),
        lastVisitAt,
      };
    },
  };
  return data;
}
export type Data = ReturnType<typeof createData>;

const g = globalThis as unknown as { __ccData?: Data };
export function getData(): Data {
  return (g.__ccData ??= createData(getDb()));
}

export * from "./types";
export { DomainError } from "./ctx";
export { onChange } from "./events";
export type { ChangeEvent } from "./events";
export { ideaPatchSchema, EDITABLE_FIELDS } from "./ideas";
