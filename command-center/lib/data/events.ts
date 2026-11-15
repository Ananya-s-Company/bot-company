import { EventEmitter } from "node:events";
import type { Database } from "better-sqlite3";

// In-process change event emitter. Every repository write emits one event after
// its transaction commits. The real-time epic (E6) subscribes here (e.g. an SSE route).

export type ChangeEntity =
  | "idea"
  | "stage_change"
  | "update"
  | "decision"
  | "proposal"
  | "demo"
  | "credential"
  | "visit";

export interface ChangeEvent {
  entity: ChangeEntity;
  id: string | number;
  action: "created" | "updated";
  at: string;
}

const g = globalThis as unknown as { __ccEmitter?: EventEmitter };
// Singleton survives Next.js dev hot reloads.
export const changeEmitter: EventEmitter = (g.__ccEmitter ??= new EventEmitter());
changeEmitter.setMaxListeners(100);

export function onChange(listener: (e: ChangeEvent) => void): () => void {
  changeEmitter.on("change", listener);
  return () => changeEmitter.off("change", listener);
}

export function emitChange(e: ChangeEvent): void {
  changeEmitter.emit("change", e);
}

const pending = new WeakMap<Database, ChangeEvent[]>();

/**
 * Run a write inside a transaction. Events are queued and emitted only after the
 * outermost transaction commits; a thrown error rolls back and emits nothing.
 * Nested calls join the outer transaction.
 */
export function write<T>(
  db: Database,
  now: () => Date,
  fn: (emit: (entity: ChangeEntity, id: string | number, action?: "created" | "updated") => void) => T,
): T {
  const nested = db.inTransaction;
  const queue = nested ? (pending.get(db) ?? []) : [];
  const emit = (entity: ChangeEntity, id: string | number, action: "created" | "updated" = "updated") =>
    queue.push({ entity, id, action, at: now().toISOString() });
  if (nested) return fn(emit);
  pending.set(db, queue);
  try {
    const result = db.transaction(() => fn(emit))();
    queue.forEach(emitChange);
    return result;
  } finally {
    pending.delete(db);
  }
}
