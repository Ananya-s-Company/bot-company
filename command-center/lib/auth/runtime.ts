import { getDb } from "../data/db";
import { clockNow } from "../test-overrides";
import { loadAuthConfig } from "./config";
import { createAuth, type Auth } from "./service";

const g = globalThis as unknown as { __ccAuth?: Auth };

/** Process-wide auth service on the app database (survives dev hot reloads). */
export function getAuth(): Auth {
  // clockNow() honours CC_TEST_NOW only when NODE_ENV=test.
  return (g.__ccAuth ??= createAuth({ db: getDb(), now: () => clockNow(), config: loadAuthConfig() }));
}

/** Tests only: swap in an auth service backed by an in-memory DB and fake clock. */
export function setAuthForTests(a: Auth | undefined): void {
  g.__ccAuth = a;
}
