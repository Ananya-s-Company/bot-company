import type { Db } from "./db";

/** Shared context for repositories: connection plus an injectable clock (BR-14: UTC). */
export interface Ctx {
  db: Db;
  now: () => Date;
}

export class DomainError extends Error {
  constructor(
    public readonly code:
      | "validation"
      | "not_found"
      | "forbidden"
      | "stage_rule"
      | "conflict",
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const iso = (ctx: Ctx): string => ctx.now().toISOString();
