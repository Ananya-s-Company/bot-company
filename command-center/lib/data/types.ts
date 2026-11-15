// Domain types for the full spec §9 data model. UI and route handlers depend on
// these types only, never on SQLite specifics, so storage can swap later.

export const STAGES = [
  "Idea",
  "Researching",
  "Proposal",
  "Approved",
  "Building",
  "Live",
  "Killed",
] as const;
export type Stage = (typeof STAGES)[number];

/** Stages that may only be entered with a linked Approved decision (CC-14 AC2). */
export const GATED_STAGES: readonly Stage[] = ["Approved", "Building"];

export const RISK_RATINGS = ["G", "A", "R"] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];
export const RISK_LABELS: Record<RiskRating, string> = { G: "Green", A: "Amber", R: "Red" };

export const DECISION_TYPES = ["Spend", "Publish", "Sign-up", "Release", "Other"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];
export const DECISION_STATUSES = ["Pending", "Approved", "Rejected", "Withdrawn"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Who is performing a write. Bots are subject to ownership rules; the Owner is not (BR-20). */
export type Actor = { kind: "owner"; name: string } | { kind: "bot"; name: string };

export interface Idea {
  id: string;
  name: string;
  stage: Stage;
  owning_lead_bot: string;
  risk_rating: RiskRating | null;
  risk_note: string | null;
  startup_cost_cad: number | null;
  payback_weeks: number | null;
  sales_per_week_needed: number | null;
  /** FinancialsBot's reason when payback cannot be computed (CC-13 AC2). Extension to §9. */
  payback_na_reason: string | null;
  next_step: string | null;
  kill_reason: string | null;
  created_at: string; // ISO UTC (BR-14)
  updated_at: string; // ISO UTC
}

export interface StageChange {
  id: number;
  idea_id: string;
  from_stage: Stage;
  to_stage: Stage;
  by_bot: string;
  decision_id: number | null;
  at: string;
}

export interface AuditEntry {
  id: number;
  entity: "idea";
  entity_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  actor_kind: "owner" | "bot";
  actor_name: string;
  /** e.g. "edited by Ananya" for owner edits. */
  label: string;
  at: string;
}

export interface Update {
  id: number;
  bot: string;
  team: string;
  text: string;
  idea_ids: string[];
  references_update_id: number | null;
  at: string;
}

export interface DecisionLink {
  url: string;
  label: string | null;
}

export interface Decision {
  id: number;
  type: DecisionType;
  title: string;
  summary: string;
  amount_cad: number | null;
  idea_id: string | null;
  requested_by: string;
  deadline: string | null;
  status: DecisionStatus;
  owner_note: string | null;
  decided_at: string | null;
  created_at: string;
  links: DecisionLink[];
}

export interface ProposalVersion {
  idea_id: string;
  version: number;
  body_md: string;
  author_bot: string;
  at: string;
}

export interface DemoScreen {
  id: number;
  demo_id: number;
  position: number;
  asset_url_or_embed: string;
  caption: string | null;
}
export interface Demo {
  id: number;
  idea_id: string;
  title: string;
  screens: DemoScreen[];
}

export interface BotCredential {
  bot_name: string;
  status: "active" | "revoked";
  created_at: string;
  revoked_at: string | null;
}

export interface HomeSummary {
  stageCounts: Record<Stage, number>;
  totalIdeas: number;
  pendingDecisions: number;
  redIdeas: number;
  updatesSinceLastVisit: number;
  lastVisitAt: string | null;
}

/** Per-field provenance used for "edited by Ananya" labels and risk history. */
export interface FieldMeta {
  field: string;
  label: string;
  actor_kind: "owner" | "bot";
  actor_name: string;
  old_value: string | null;
  new_value: string | null;
  at: string;
}
