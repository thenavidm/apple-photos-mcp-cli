#!/usr/bin/env node
/**
 * Both binaries. `apple-photos-mcp` with no arguments serves MCP over stdio,
 * which is what an MCP client launches, and any command runs one tool from the
 * shell.
 *
 * This only runs on a Mac, but the package must still install anywhere: the HQ
 * connector imports ALL_TOOLS for its schemas on a Linux builder, never running
 * a tool, and an `"os": ["darwin"]` field would stop npm installing it at all.
 * So it installs anywhere, answers --version and --help anywhere, and refuses
 * everything else off macOS, saying why.
 *
 * Node's compile cache goes on before the app loads, so every launch after the
 * first skips compiling it again. NODE_DISABLE_COMPILE_CACHE=1 turns it off.
 */

import * as nodeModule from "node:module";

nodeModule.enableCompileCache?.();

const argv = process.argv.slice(2);
const informational = ["--version", "-v", "--help", "-h"].some((flag) => argv.includes(flag)) || argv[0] === "help";
if (!informational && process.platform !== "darwin") {
  process.stderr.write(
    `${JSON.stringify(
      {
        error:
          "Apple Photos only exists on macOS, so this server cannot run on " +
          `${process.platform}. It installs anywhere because the tool definitions are ` +
          "read by other tooling, but reaching a library needs a Mac.",
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

const { app } = await import("./app.js");
await app.main();
