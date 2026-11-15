// npm run admin:reset-2fa [-- --yes]
// Lost authenticator and all recovery codes (CC-01 edge case): removes the TOTP secret and
// every recovery code and ends all sessions. The password is unchanged.
import { adminReset2fa } from "../lib/auth/admin";
import { hasFlag, io, setup } from "./admin-common";

void (async () => {
  const { db, auth, file } = setup();
  console.log(`Database: ${file}`);
  const code = await adminReset2fa(auth, io, { yes: hasFlag("yes") });
  db.close();
  process.exit(code);
})();
