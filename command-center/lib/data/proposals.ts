import { DomainError, iso, type Ctx } from "./ctx";
import { write } from "./events";
import type { ProposalVersion } from "./types";

// Storage only in this run; proposal pages are epic E4. body_md is raw bot markdown and
// MUST be rendered through components/SafeMarkdown (BR-18).
export function createProposalsRepo(ctx: Ctx) {
  const { db } = ctx;
  return {
    /** Each post is a new version (CC-41 AC1). Ownership (BR-12) is enforced by the E7 layer. */
    addVersion(ideaId: string, body_md: string, author_bot: string): ProposalVersion {
      if (!body_md.trim()) throw new DomainError("validation", "Proposal body is required", "body_md");
      return write(db, ctx.now, (emit) => {
        if (!db.prepare("SELECT 1 FROM ideas WHERE id = ?").get(ideaId)) throw new DomainError("not_found", `Idea ${ideaId} not found`);
        const t = iso(ctx);
        db.prepare("INSERT OR IGNORE INTO proposals (idea_id, created_at) VALUES (?, ?)").run(ideaId, t);
        const next =
          ((db.prepare("SELECT MAX(version) v FROM proposal_versions WHERE idea_id = ?").get(ideaId) as { v: number | null }).v ?? 0) + 1;
        db.prepare("INSERT INTO proposal_versions (idea_id,version,body_md,author_bot,at) VALUES (?,?,?,?,?)").run(ideaId, next, body_md, author_bot, t);
        emit("proposal", ideaId, next === 1 ? "created" : "updated");
        return { idea_id: ideaId, version: next, body_md, author_bot, at: t };
      });
    },
    latest(ideaId: string): ProposalVersion | null {
      return (
        (db.prepare("SELECT * FROM proposal_versions WHERE idea_id = ? ORDER BY version DESC LIMIT 1").get(ideaId) as
          | ProposalVersion
          | undefined) ?? null
      );
    },
    versions(ideaId: string): ProposalVersion[] {
      return db.prepare("SELECT * FROM proposal_versions WHERE idea_id = ? ORDER BY version DESC").all(ideaId) as ProposalVersion[];
    },
  };
}
