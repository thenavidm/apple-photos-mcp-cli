/**
 * The seam that matters: TypeScript declares the tools, Python implements them.
 *
 * If the two lists drift, the CLI offers a command the engine cannot run, or
 * the engine grows a tool nobody can reach. Neither shows up until someone
 * tries it, which is exactly the failure that left the hosted connector with 11
 * of 13 tools for months.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { cli } from "@thenavidm/slipway/testing";

import { app } from "../src-ts/app.js";
import { ALL_TOOLS, TOOLS } from "../src-ts/tools/index.js";

const root = join(import.meta.dirname, "..");
const python = readFileSync(join(root, "src", "apple_photos_mcp", "server.py"), "utf8");

/** Tool names the Python engine actually registers. */
function pythonTools(): string[] {
  const names: string[] = [];
  const pattern = /@mcp\.tool[^\n]*\n(?:@[^\n]*\n)*\s*(?:async\s+)?def\s+(\w+)\(/g;
  for (const match of python.matchAll(pattern)) names.push(match[1] as string);
  return names;
}

describe("TypeScript and Python agree", () => {
  it("declares exactly the tools the engine implements", () => {
    expect([...ALL_TOOLS.map((t) => t.python ?? t.name)].sort()).toEqual(pythonTools().sort());
  });

  it("serves every declared tool, under the same name", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(ALL_TOOLS.map((spec) => spec.name));
  });
});

describe("every tool is a command", () => {
  it("lists all thirteen, the engine's doctor as check-setup, since doctor is the CLI's own", async () => {
    const context = JSON.parse((await cli(app, ["agent-context", "--brief"], { env: {} })).stdout);
    const commands = (context.commands as Array<{ command: string }>).map((c) => c.command);
    expect(commands).toHaveLength(13);
    expect(commands).toContain("check-setup");
    expect(commands).not.toContain("doctor");
  });

  it("gives every schema key a flag in the command's help", async () => {
    for (const tool of TOOLS) {
      const help = (await cli(app, [tool.command, "--help"], { env: {} })).stdout;
      for (const key of Object.keys((tool.jsonSchema.properties as Record<string, unknown>) ?? {})) {
        expect(help, `${tool.command} --help has no --${key.replace(/_/g, "-")}`).toContain(`--${key.replace(/_/g, "-")}`);
      }
    }
  });
});
