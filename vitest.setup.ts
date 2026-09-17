import { config } from "dotenv";

// Vitest does not load .env on its own. The domain tests (Tasks 1-4) need no
// environment variables, so this is a no-op for them; the db tests (Task 5+)
// need DATABASE_URL_TEST, which this makes available via process.env.
config({ quiet: true });
