/**
 * The bridge to the Python engine.
 *
 * Apple Photos is the one case the house standard carves out for Python: the
 * only libraries that can read a Photos library are `osxphotos` and
 * `photoscript`, both Python-only, both macOS-only, both pulling in pyobjc.
 * Reimplementing them in TypeScript would mean reimplementing Apple's private
 * SQLite schema, which is not a thing to own.
 *
 * So the engine stays Python and this layer wraps it, the way
 * google-workspace-mcp wraps the `gws` binary. What TypeScript buys is the part
 * Python cost us: `npx` with no toolchain to install first, a CLI generated
 * from the same tool array as the MCP server, and a static `ALL_TOOLS` that the
 * HQ connector can import so the hosted surface cannot drift from this one.
 *
 * Calls are proxied to the Python MCP server over stdio, through the small
 * client in engine.ts, so the Python needs no changes and there is one
 * implementation of every tool.
 */

import type { Config } from "./config.js";
import { StdioEngine } from "./engine.js";
import { BridgeError } from "./errors.js";
import { VERSION } from "./version.js";

/** A content part as the MCP protocol carries it: text, image, or anything later. */
export type ContentPart = { type: string; text?: string; data?: string; mimeType?: string };

export type BridgeResult = {
  /** Every part, untouched. Images must survive: look_at_photos returns them. */
  content: ContentPart[];
  /** The text parts joined, for the common case of a JSON payload. */
  text: string;
  isError: boolean;
};

export class PythonBridge {
  private readonly config: Config;
  private engine?: StdioEngine;
  private starting?: Promise<StdioEngine>;
  /** The tail of the engine's stderr, so a failure can say what actually went wrong. */
  private stderrTail = "";

  constructor(config: Config) {
    this.config = config;
  }

  private async connect(): Promise<StdioEngine> {
    if (this.engine) return this.engine;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const engine: StdioEngine = new StdioEngine({
        command: this.config.pythonCommand,
        args: this.config.pythonArgs,
        env: this.config.pythonEnv,
        clientInfo: { name: "apple-photos-cli", version: VERSION },
        // Drained as it arrives: osxphotos is chatty on a large library, and an
        // unread pipe fills and blocks the engine. Keeping the tail also means a
        // failure can name the actual cause, a missing module or a Full Disk
        // Access denial, instead of a boilerplate "install uv".
        onStderr: (chunk) => {
          this.stderrTail = (this.stderrTail + chunk).slice(-4000);
        },
        // A dead engine must not stay cached, or one crash breaks every later
        // call for the life of the process.
        onClose: () => {
          if (this.engine === engine) this.engine = undefined;
        },
      });

      try {
        // A cold `uv` run builds pyobjc, which takes longer than a minute on a
        // fresh cache, so the wait is the configured startup timeout.
        await engine.start(this.config.startupTimeoutMs);
      } catch (error) {
        throw new BridgeError(
          `Could not start the Photos engine with \`${this.config.pythonCommand} ${this.config.pythonArgs.join(" ")}\`. ` +
            `Install uv (https://docs.astral.sh/uv/) or set APPLE_PHOTOS_PYTHON to a Python that has osxphotos and photoscript.`,
          [(error as Error).message, this.stderrTail.trim()].filter(Boolean).join("\n"),
        );
      }

      this.engine = engine;
      return engine;
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  /**
   * Call one Python tool and return every content part.
   *
   * `timeoutMs` matters: exporting originals pulls them out of iCloud first and
   * rendering previews is not quick either, so a short default would cancel
   * work the engine is still doing.
   */
  async call(tool: string, args: Record<string, unknown>, timeoutMs?: number): Promise<BridgeResult> {
    const engine = await this.connect();

    let result: { content?: ContentPart[]; isError?: boolean };
    try {
      result = (await engine.request("tools/call", { name: tool, arguments: args }, timeoutMs ?? this.config.requestTimeoutMs)) as {
        content?: ContentPart[];
        isError?: boolean;
      };
    } catch (error) {
      throw new BridgeError(
        `The Photos engine failed while running ${tool}.`,
        [(error as Error).message, this.stderrTail.trim()].filter(Boolean).join("\n"),
      );
    }

    const content = result?.content ?? [];
    const text = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n");

    return { content, text, isError: result?.isError === true };
  }

  /** What the Python server says it offers, for checking the two lists agree. */
  async listTools(): Promise<string[]> {
    const engine = await this.connect();
    const { tools } = (await engine.request("tools/list", {}, this.config.requestTimeoutMs)) as { tools: Array<{ name: string }> };
    return tools.map((tool) => tool.name);
  }

  async close(): Promise<void> {
    this.starting = undefined;
    const engine = this.engine;
    this.engine = undefined;
    await engine?.close().catch(() => undefined);
  }
}
