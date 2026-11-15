import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // Never touch data/command-center.db from tests (lib/data/db.ts honours ":memory:").
    env: { DATABASE_PATH: ":memory:", NODE_ENV: "test" },
    // argon2id with OWASP parameters is deliberately slow; enrolment hashes 10 codes.
    testTimeout: 30_000,
  },
});
