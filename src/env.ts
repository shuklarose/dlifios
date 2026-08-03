// Loads .env when one exists.
//
// process.loadEnvFile() throws ENOENT if the file is missing, which is fine on
// a developer machine and wrong everywhere else: in a container the values are
// already in the environment and there is no file to read. Importing this
// module instead of calling loadEnvFile directly keeps both paths working.
//
// Import for side effect, before reading anything off process.env:
//   import "./env.ts";

import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}
