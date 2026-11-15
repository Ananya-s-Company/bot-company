// Host-only admin commands (CC-01 AC7). No email flow exists: these run on the machine
// that holds the database and are the only way to set or reset the password, reset 2FA
// or clear throttles. Thin wrappers live in scripts/admin-*.ts; the logic is here so it
// can be tested. Output never contains a password, hash, TOTP secret or recovery code.
import type { Auth } from "./service";

export interface AdminIo {
  /** Read a secret without echo (TTY) or one line from piped stdin. */
  readSecret(prompt: string): Promise<string>;
  /** Read a visible line. */
  readLine(prompt: string): Promise<string>;
  out(msg: string): void;
  interactive: boolean;
}

export async function adminSetPassword(auth: Auth, io: AdminIo, args: { username?: string }): Promise<number> {
  const st = auth.status();
  const fallback = st.username ?? "owner";
  let username = args.username?.trim() ?? "";
  if (!username) username = io.interactive ? (await io.readLine(`Username [${fallback}]: `)).trim() || fallback : fallback;
  const pw = await io.readSecret("New password (input hidden, at least 12 characters): ");
  if (io.interactive) {
    const again = await io.readSecret("Repeat new password: ");
    if (again !== pw) {
      io.out("Passwords do not match. Nothing changed.");
      return 1;
    }
  }
  try {
    await auth.setPassword(username, pw);
  } catch (e) {
    io.out(`${(e as Error).message} Nothing changed.`);
    return 1;
  }
  const after = auth.status();
  io.out(`Password ${st.accountExists ? "reset" : "set"} for "${after.username}". All sessions ended; throttles cleared.`);
  io.out(
    after.totpEnrolled
      ? "Two-factor sign-in stays on: sign in with your authenticator code or a recovery code."
      : "Two-factor sign-in is not set up yet: after signing in you will be asked to enrol an authenticator app.",
  );
  return 0;
}

export async function adminReset2fa(auth: Auth, io: AdminIo, args: { yes?: boolean }): Promise<number> {
  if (!auth.status().accountExists) {
    io.out("No owner account yet. Run npm run admin:set-password first.");
    return 1;
  }
  if (!args.yes) {
    if (!io.interactive) {
      io.out("Refusing to reset 2FA non-interactively without --yes.");
      return 1;
    }
    const a = (await io.readLine('This removes the authenticator and all recovery codes and signs out everywhere. Type "reset" to continue: ')).trim();
    if (a !== "reset") {
      io.out("Cancelled. Nothing changed.");
      return 1;
    }
  }
  auth.resetTwoFactor();
  io.out("Two-factor sign-in reset. All sessions ended. Sign in with your password and enrol a new authenticator app.");
  return 0;
}

export function adminUnlock(auth: Auth, io: AdminIo): number {
  const n = auth.unlock();
  io.out(`Sign-in throttles cleared (${n} recorded attempt${n === 1 ? "" : "s"} removed). Sessions were not changed.`);
  return 0;
}
