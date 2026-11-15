// npm run admin:unlock
// Clears every per-IP sign-in throttle and the account-wide backoff. Sessions, password
// and 2FA are unchanged.
import { adminUnlock } from "../lib/auth/admin";
import { io, setup } from "./admin-common";

const { db, auth, file } = setup();
console.log(`Database: ${file}`);
const code = adminUnlock(auth, io);
db.close();
process.exit(code);
