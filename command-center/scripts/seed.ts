import { createData } from "../lib/data";
import { defaultDbPath, openDb } from "../lib/data/db";
import { seedIdeas, seedSamples } from "../lib/data/seed";

const file = defaultDbPath();
const db = openDb(file); // creates the file and runs migrations
const data = createData(db);
const created = seedIdeas(data);
const samples = seedSamples(data);
console.log(`Database: ${file}`);
console.log(`Ideas created: ${created} (total ${data.ideas.list().length})`);
console.log(samples ? "Sample updates and decision created." : "Sample rows already present.");
db.close();
