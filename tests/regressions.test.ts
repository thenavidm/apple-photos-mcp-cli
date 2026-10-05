/**
 * One test per bug found in the 1.0.3 review, kept through the move to Slipway.
 *
 * The parity suite next door only matched tool names out of the engine, so it
 * was green while every one of these was live. A name check is not a contract.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { cli, connect } from "@thenavidm/slipway/testing";

import { app, createApp } from "../src-ts/app.js";
import type { PythonBridge } from "../src-ts/bridge.js";
import { loadConfig } from "../src-ts/config.js";
import { BridgeError, ToolError } from "../src-ts/errors.js";
import { ALL_TOOLS, TOOLS } from "../src-ts/tools/index.js";
import { toSlipway } from "../src-ts/tools/kit.js";

const root = join(import.meta.dirname, "..");
const python = readFileSync(join(root, "src", "apple_photos_mcp", "server.py"), "utf8");
const propertyOf = (tool: string, key: string) =>
  (TOOLS.find((t) => t.name === tool)!.jsonSchema.properties as Record<string, { maximum?: number; minimum?: number }>)[key]!;

/** Pull a numeric bound out of the engine, so the test tracks it rather than a copy. */
function clamp(pattern: RegExp): number {
  const m = python.match(pattern);
  if (!m) throw new Error(`engine clamp not found: ${pattern}`);
  return Number(m[1]);
}

/** An app whose engine answers every call with these parts, recording what it was sent. */
function withEngine(parts: Array<{ type: string; text?: string; data?: string; mimeType?: string }>) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const bridge = {
    call: async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      return { content: parts, text: parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"), isError: false };
    },
  } as unknown as PythonBridge;
  return { calls, app: createApp({ context: () => ({ config: loadConfig({}), bridge }) }) };
}

describe("schema bounds match the engine", () => {
  it("caps limit where the engine caps it", () => {
    expect(propertyOf("search_photos", "limit").maximum, "advertising a limit the engine silently clamps").toBe(clamp(/min\(limit,\s*(\d+)\)/));
  });

  it("floors preview size where the engine floors it", () => {
    expect(propertyOf("look_at_photos", "size").minimum).toBe(clamp(/max\((\d+),\s*min\(size/));
  });
});

describe("images survive the bridge", () => {
  /**
   * look_at_photos returns text captions interleaved with images. Serialising
   * that into a string deleted every picture, leaving the one tool whose whole
   * purpose is seeing returning filenames.
   */
  const parts = [
    { type: "text", text: "IMG_1.jpg" },
    { type: "image", data: "AAAA", mimeType: "image/jpeg" },
  ];

  it("passes content parts through untouched over MCP", async () => {
    const mcp = await connect(withEngine(parts).app);
    const result = await mcp.callTool("look_at_photos", { refs: ["a"] });
    await mcp.close();
    expect(result.content).toEqual(parts);
  });

  it("prints the same parts as JSON on the CLI, which HQ's agent hands back", async () => {
    const run = await cli(withEngine(parts).app, ["look-at-photos", "a", "--json"], { env: {} });
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(parts);
  });

  it("still returns ordinary data as data", async () => {
    const run = await cli(withEngine([{ type: "text", text: '{"total":3}' }]).app, ["library-stats", "--agent"], { env: {} });
    expect(JSON.parse(run.stdout)).toEqual({ total: 3 });
  });
});

describe("CLI arguments", () => {
  it("takes several bare refs", async () => {
    const engine = withEngine([{ type: "text", text: "{}" }]);
    await cli(engine.app, ["photo-info", "uuid1", "uuid2", "uuid3", "--agent"], { env: {} });
    expect(engine.calls[0]).toEqual({ tool: "photo_info", args: { refs: ["uuid1", "uuid2", "uuid3"] } });
  });

  it("still refuses a second positional for a non-repeatable flag", async () => {
    const run = await cli(withEngine([]).app, ["set-photo-title", "a", "b", "--title", "x", "--agent"], { env: {} });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr).error).toMatch(/Unexpected argument/);
  });

  it("tells the engine an archive is confirmed only once Slipway has confirmed it", async () => {
    const engine = withEngine([{ type: "text", text: '{"ok":true}' }]);
    expect((await cli(engine.app, ["archive-photos", "a", "--agent"], { env: {} })).code).toBe(2);
    expect(engine.calls).toEqual([]);
    expect((await cli(engine.app, ["archive-photos", "a", "--confirm", "--agent"], { env: {} })).code).toBe(0);
    expect(engine.calls).toEqual([{ tool: "archive_photos", args: { refs: ["a"], confirm: true } }]);
  });
});

describe("no leftovers from the repo this CLI was adapted from", () => {
  it("advertises no command that does not exist", async () => {
    for (const phantom of ["capture", "imagine", "whoami"]) {
      expect((await cli(app, [phantom, "--agent"], { env: {} })).code, `${phantom} is advertised but unroutable`).toBe(2);
    }
  });

  it("aliases only keys some tool declares", () => {
    const keys = new Set(ALL_TOOLS.flatMap((t) => Object.keys(t.schema)));
    for (const [alias, key] of Object.entries(app.definition.flagAliases ?? {})) {
      expect(keys.has(key), `--${alias} points at '${key}', which no tool declares`).toBe(true);
    }
  });

  it("maps synonyms onto vocabulary the tools contain", () => {
    const vocabulary = new Set(ALL_TOOLS.flatMap((t) => `${t.name} ${t.title} ${t.description}`.toLowerCase().split(/[^a-z0-9]+/)));
    for (const target of new Set(Object.values(app.definition.synonyms ?? {}).flat())) {
      expect(vocabulary.has(target), `synonym target '${target}' appears in no tool`).toBe(true);
    }
  });

  /** The query that returned four browsing tools and never the right one. */
  it("answers 'save my photos to disk' with export-originals", async () => {
    const first = (await cli(app, ["which", "save", "my", "photos", "to", "disk"], { env: {} })).stdout.split("\n")[0];
    expect(first).toContain("export-originals");
  });
});

describe("engine invocation", () => {
  it("passes --no-project so uv does not adopt the caller's project", () => {
    expect(loadConfig({}).pythonArgs).toContain("--no-project");
  });

  it("allows enough time for a cold start and an iCloud export", () => {
    const config = loadConfig({});
    expect(config.startupTimeoutMs).toBeGreaterThan(60_000);
    expect(config.requestTimeoutMs).toBeGreaterThan(60_000);
  });
});

describe("exit codes follow the house contract", () => {
  const code = (error: unknown) => (toSlipway(error) as { exitCode: number }).exitCode;

  it("too many items is 2", () => {
    expect(code(new ToolError("150 items requested; this server allows at most 100"))).toBe(2);
  });

  it("nothing resolving is 3", () => {
    expect(code(new ToolError("none of those refs resolved"))).toBe(3);
  });

  it("macOS refusing access is 4", () => {
    expect(code(new ToolError("[Errno 1] Operation not permitted: '/Users/x/Pictures/Photos Library.photoslibrary/database/Photos.sqlite'"))).toBe(4);
    expect(code(new ToolError("Not authorized to send Apple events to Photos. (-1743)"))).toBe(4);
  });

  it("an engine that never started is 10, one that failed mid-call is 5", () => {
    expect(code(new BridgeError("Could not start the Photos engine with `uvx ...`."))).toBe(10);
    expect(code(new BridgeError("The Photos engine failed while running search_photos."))).toBe(5);
  });

});
