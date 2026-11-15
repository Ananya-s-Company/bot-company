import { withOwnerApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Session status for the signed-in Owner (forms and pollers use it to detect an expired
 * session). A background endpoint: checking it never extends the 12 h idle window
 * (ArchitectBot (a)). 401 JSON with no data when not signed in (AC1).
 */
export const GET = withOwnerApi(
  async (_req, _ctx, s) =>
    Response.json({
      authenticated: true,
      mfa: s.mfa,
      signedInAt: s.createdAt.toISOString(),
      idleExpiresAt: s.idleExpiresAt.toISOString(),
      mustReauthenticateBy: s.absoluteExpiresAt.toISOString(),
    }),
  { background: true },
);
