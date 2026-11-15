// AUTH PLACEHOLDER (Run B implements CC-01). Nothing here authenticates anyone.
// TODO(Run B): replace with real session lookup (password + TOTP, idle/absolute timeouts).
// Server actions and pages must obtain the acting Owner through getOwner() so that
// swapping in real auth does not touch call sites.

export interface Owner {
  name: string;
  /** True while running without login (local access only). */
  unauthenticatedLocal: boolean;
}

export function getOwner(): Owner {
  return { name: "Ananya", unauthenticatedLocal: true };
}
