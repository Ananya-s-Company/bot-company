// npm run admin:set-password [-- --username=<name>]
// Initial setup and password reset (CC-01 AC7). Host machine only; the password is read
// from stdin without echo (or from the first line of piped stdin). Ends every session.
import { adminSetPassword } from "../lib/auth/admin";
import { argValue, io, setup } from "./admin-common";

void (async () => {
  const { db, auth, file } = setup();
  console.log(`Database: ${file}`);
  const code = await adminSetPassword(auth, io, { username: argValue("username") });
  db.close();
  process.exit(code);
})();
