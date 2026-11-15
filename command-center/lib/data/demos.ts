import { DomainError, type Ctx } from "./ctx";
import { write } from "./events";
import type { Demo, DemoScreen } from "./types";

// Storage only in this run (epic E5). Embedded prototype hosts must be allow-listed
// when rendered (BR-13); the repository stores values as given.
export function createDemosRepo(ctx: Ctx) {
  const { db } = ctx;
  return {
    create(ideaId: string, title: string, screens: { asset_url_or_embed: string; caption?: string | null }[]): Demo {
      if (!title.trim()) throw new DomainError("validation", "Demo title is required", "title");
      return write(db, ctx.now, (emit) => {
        if (!db.prepare("SELECT 1 FROM ideas WHERE id = ?").get(ideaId)) throw new DomainError("not_found", `Idea ${ideaId} not found`);
        const id = Number(db.prepare("INSERT INTO demos (idea_id,title) VALUES (?,?)").run(ideaId, title.trim()).lastInsertRowid);
        screens.forEach((s, i) =>
          db
            .prepare("INSERT INTO demo_screens (demo_id,position,asset_url_or_embed,caption) VALUES (?,?,?,?)")
            .run(id, i + 1, s.asset_url_or_embed, s.caption ?? null),
        );
        emit("demo", id, "created");
        return this.listForIdea(ideaId).find((d) => d.id === id)!;
      });
    },
    listForIdea(ideaId: string): Demo[] {
      const demos = db.prepare("SELECT id, idea_id, title FROM demos WHERE idea_id = ? ORDER BY id").all(ideaId) as Omit<Demo, "screens">[];
      return demos.map((d) => ({
        ...d,
        screens: db.prepare("SELECT * FROM demo_screens WHERE demo_id = ? ORDER BY position").all(d.id) as DemoScreen[],
      }));
    },
  };
}
