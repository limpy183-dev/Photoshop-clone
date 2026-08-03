import { lane } from "./base"

/**
 * No-server lane for the pure-logic specs. Contract: always invoked with an
 * explicit list of spec files (see scripts/select-pr-tests.mjs) — it has no
 * webServer, so a bare `--config=playwright/node.config.ts` with no file
 * arguments would try to sweep the whole suite against nothing.
 */
export default lane({
  projects: [{ name: "node" }],
})
