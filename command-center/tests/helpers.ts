import { createData } from "../lib/data";
import { openDb } from "../lib/data/db";

/** Fresh in-memory database with a controllable clock. */
export function makeData(start = "2026-11-15T12:00:00.000Z") {
  let t = Date.parse(start);
  const data = createData(openDb(":memory:"), () => new Date(t));
  return {
    data,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export const owner = { kind: "owner", name: "Ananya" } as const;
export const bot = (name: string) => ({ kind: "bot", name }) as const;
