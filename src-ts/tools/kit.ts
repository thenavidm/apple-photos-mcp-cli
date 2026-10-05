/**
 * Shared plumbing every tool uses. One spec feeds the MCP server and the CLI,
 * through Slipway, and the HQ connector, which imports `ALL_TOOLS` for its
 * schemas and so keeps this shape: name, title, description, a Zod shape with
 * `confirm` on the one destructive tool, and a risk.
 */

import { ApiError, AuthError, NotConfiguredError, NotFoundError, SlipwayError, UsageError, content, toolkit, z, type Risk, type Tool } from "@thenavidm/slipway";

import type { PythonBridge } from "../bridge.js";
import type { Config } from "../config.js";
import { BridgeError, PhotosError, ToolError } from "../errors.js";

export type { Risk };

/** What every tool runs with: the engine and the settings it was started with. */
export type ToolContext = { bridge: PythonBridge; config: Config };

export const confirmArg = {
  confirm: z
    .boolean()
    .optional()
    .describe("Must be true for this to run. It cannot be undone from here, so it is refused without an explicit confirmation."),
};

export type ToolSpec<S extends z.ZodRawShape> = {
  name: string;
  /** The CLI command, when the name with dashes is one the CLI already uses. */
  command?: string;
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  idempotent?: boolean;
  /** Override the per-call deadline. Exports pull originals out of iCloud first. */
  timeoutMs?: number;
  /** The Python tool this proxies to. Defaults to `name`. */
  python?: string;
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
};

export function defineTool<S extends z.ZodRawShape>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

export type AnyToolSpec = Omit<ToolSpec<z.ZodRawShape>, "summary"> & { summary?: (args: never) => string };

/**
 * A failure as the Slipway error that carries its exit code, as 1.1 gave them:
 * an engine that never started is setup, 10; macOS refusing access is 4; a
 * request over a cap is 2; refs that resolve to nothing are 3; anything else
 * the engine reports is 5.
 */
export function toSlipway(error: unknown): unknown {
  if (error instanceof SlipwayError || !(error instanceof Error)) return error;
  const text = error.message.toLowerCase();
  const options = error instanceof PhotosError && error.detail ? { details: { detail: error.detail.slice(0, 500) } } : {};
  if (error instanceof BridgeError && /could not start/.test(text)) return new NotConfiguredError(error.message, options);
  if (/operation not permitted|permission denied|not authori[sz]ed|full disk access|-1743/.test(text)) return new AuthError(error.message, options);
  if (/at most|too many/.test(text)) return new UsageError(error.message, options);
  if (/not found|none of those refs resolved|no such/.test(text)) return new NotFoundError(error.message, options);
  return new ApiError(error.message, options);
}

/**
 * Every tool runs the same way: hand the arguments to Python.
 *
 * There is no per-tool handler, because there is nothing per-tool to do. The
 * Python server already implements all thirteen; this layer gives them a
 * second surface, an install story and a schema HQ can import.
 */
export async function runTool(spec: AnyToolSpec, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  // Only undefined and null are dropped. An empty string is a real value here:
  // clearing a caption is `set_photo_description --description ""`, and
  // stripping it made the engine reject the call for a missing required
  // argument the caller had plainly supplied.
  const payload: Record<string, unknown> = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null));
  // Slipway lets an irreversible call reach this point only once it is
  // confirmed, and the engine asks for the same confirmation in its own words.
  if (spec.risk === "destructive") payload.confirm = true;

  const result = await ctx.bridge.call(spec.python ?? spec.name, payload, spec.timeoutMs);
  if (result.isError) throw new ToolError(result.text || `${spec.name} failed.`);

  // Anything that is not plain text, the images from look_at_photos, goes back
  // as content parts, and the CLI prints the same parts as JSON, which is what
  // the HQ agent hands back to the hosted connector.
  if (result.content.some((part) => part.type !== "text")) return content(result.content as Parameters<typeof content>[0], result.content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return result.text;
  }

  // The engine reports its own failures as an ordinary return carrying
  // {"error": ...}, which the protocol marks successful. Without this check a
  // failed export exited 0 with the error printed on stdout, so
  // `export-originals ... && rm ...` would go on to delete the source.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (typeof record.error === "string" && record.ok !== true) throw new ToolError(record.error);
  }
  return parsed;
}

const kit = toolkit<ToolContext>();

/** The specs as Slipway tools. `confirm` is Slipway's own, so it leaves each schema here. */
export function slipwayTools(specs: readonly AnyToolSpec[]): Tool<ToolContext>[] {
  return specs.map((spec) => {
    const { confirm: _confirm, ...shape } = spec.schema;
    return kit.defineTool({
      name: spec.name,
      ...(spec.command ? { command: spec.command } : {}),
      title: spec.title,
      description: spec.description,
      input: z.object(shape),
      risk: spec.risk,
      ...(spec.idempotent === undefined ? {} : { idempotent: spec.idempotent }),
      // Everything stays on this Mac: no network, no upload, nothing leaves.
      openWorld: false,
      // 1.1's words for the one destructive tool's refusal.
      ...(spec.risk === "destructive" ? { consequence: "cannot be undone from here" } : {}),
      ...(spec.summary ? { summary: spec.summary as (args: Record<string, unknown>) => string } : {}),
      handler: async (args, ctx) => {
        try {
          return await runTool(spec, args as Record<string, unknown>, ctx);
        } catch (error) {
          throw toSlipway(error);
        }
      },
    });
  });
}
