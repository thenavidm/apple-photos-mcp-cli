/**
 * The bridge to the engine, against a fake engine that speaks MCP over stdio.
 *
 * The bridge used to ride on the MCP SDK's client; it now has its own small
 * one, so these cover what that client did for it: the handshake, the engine's
 * own questions answered, images kept, a crash that frees whatever waited on it
 * and lets the next call start a fresh engine, and an engine that cannot start
 * at all reported as setup, not as a failure of the library.
 */

import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PythonBridge } from "../src-ts/bridge.js";
import { loadConfig, type Config } from "../src-ts/config.js";
import { StdioEngine } from "../src-ts/engine.js";
import { BridgeError } from "../src-ts/errors.js";

const fake = fileURLToPath(new URL("./fixtures/fake-engine.mjs", import.meta.url));
const config = (overrides: Partial<Config> = {}): Config => ({
  ...loadConfig({}),
  pythonCommand: process.execPath,
  pythonArgs: [fake],
  pythonEnv: { PATH: process.env.PATH ?? "" },
  startupTimeoutMs: 10_000,
  requestTimeoutMs: 10_000,
  ...overrides,
});

const open: PythonBridge[] = [];
const bridge = (overrides: Partial<Config> = {}) => {
  const made = new PythonBridge(config(overrides));
  open.push(made);
  return made;
};
afterEach(async () => {
  await Promise.all(open.splice(0).map((made) => made.close()));
});

describe("the engine client", () => {
  it("completes the handshake, calls a tool and answers what the engine asks", async () => {
    const engine = new StdioEngine({ command: process.execPath, args: [fake], env: { PATH: process.env.PATH ?? "" }, clientInfo: { name: "test", version: "0" } });
    await engine.start(10_000);
    const result = (await engine.request("tools/call", { name: "echo", arguments: { refs: ["a"] } }, 10_000)) as { content: Array<{ text: string }> };
    await engine.close();
    const echoed = JSON.parse(result.content[0]!.text);
    expect(echoed.args).toEqual({ refs: ["a"] });
    // A ping is answered with an empty result, anything else this client does not offer with "method not found".
    expect(echoed.answered["ping-1"]).toEqual({});
    expect(echoed.answered["roots-1"]).toMatchObject({ code: -32601 });
  });

  it("gives up on a call the engine never answers, after the time it was given", async () => {
    const engine = new StdioEngine({ command: process.execPath, args: [fake], env: { PATH: process.env.PATH ?? "" }, clientInfo: { name: "test", version: "0" } });
    await engine.start(10_000);
    await expect(engine.request("tools/call", { name: "slow", arguments: {} }, 200)).rejects.toThrow(/no answer from the engine within/);
    await engine.close();
  });
});

describe("the bridge", () => {
  it("keeps images as content parts, and joins the text for JSON", async () => {
    const result = await bridge().call("image", {});
    expect(result.content).toEqual([
      { type: "text", text: "IMG_1.jpg" },
      { type: "image", data: "AAAA", mimeType: "image/jpeg" },
    ]);
    expect(result.text).toBe("IMG_1.jpg");
  });

  it("frees a call when the engine dies, and starts a fresh engine for the next", async () => {
    const made = bridge();
    await expect(made.call("crash", {})).rejects.toBeInstanceOf(BridgeError);
    const result = await made.call("echo", { n: 1 });
    expect(JSON.parse(result.text).args).toEqual({ n: 1 });
  });

  it("reports an engine that cannot start as setup, naming the command", async () => {
    const error = await bridge({ pythonCommand: "/nonexistent/python", pythonArgs: ["-m", "apple_photos_mcp"] })
      .call("echo", {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).message).toMatch(/^Could not start the Photos engine with `\/nonexistent\/python -m apple_photos_mcp`/);
    expect((error as BridgeError).detail).toMatch(/ENOENT/);
  });

  it("lists the engine's tools", async () => {
    expect(await bridge().listTools()).toEqual(["echo", "image"]);
  });
});
