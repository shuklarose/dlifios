// process.loadEnvFile() throws when there is no .env, which is right on a
// developer machine and wrong in a container, where the values are already in
// the environment. Import this for side effect instead of calling it directly.

import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}
