// Shared setup for the host-only admin CLIs. Reads .env.local (like Next.js) so the
// same DATABASE_PATH is used, opens the database and builds the auth service.
import fs from "node:fs";
import readline from "node:readline";
import { loadAuthConfig } from "../lib/auth/config";
import type { AdminIo } from "../lib/auth/admin";
import { createAuth } from "../lib/auth/service";
import { defaultDbPath, openDb } from "../lib/data/db";

export function setup() {
  for (const f of [".env.local", ".env"]) {
    if (fs.existsSync(f)) {
      process.loadEnvFile(f);
      break;
    }
  }
  const file = defaultDbPath();
  const db = openDb(file);
  const auth = createAuth({ db, now: () => new Date(), config: loadAuthConfig() });
  return { db, auth, file };
}

const interactive = !!process.stdin.isTTY;
let pipedLines: string[] | null = null;
async function nextPipedLine(): Promise<string> {
  if (pipedLines === null) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    pipedLines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  }
  return pipedLines.shift() ?? "";
}

/** Reads a secret with no echo on a TTY (raw mode). Prompts go to stderr. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stderr.write("\nCancelled.\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function readVisible(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(prompt, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

export const io: AdminIo = {
  interactive,
  readSecret: (p) => (interactive ? readHidden(p) : nextPipedLine()),
  readLine: (p) => (interactive ? readVisible(p) : nextPipedLine()),
  out: (m) => console.log(m),
};

export const argValue = (name: string): string | undefined => {
  const pre = `--${name}=`;
  return process.argv.find((a) => a.startsWith(pre))?.slice(pre.length);
};
export const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);
