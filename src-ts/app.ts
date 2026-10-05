/**
 * The Apple Photos app: everything Slipway needs to ship the MCP server and the CLI.
 *
 * Mac only. The tools are declared here in TypeScript and run by the Python
 * engine, which reads the library through osxphotos and photoscript; the
 * bridge starts it on the first call. This file only describes; `index.ts` runs.
 */

import { slipway, type DoctorCheck } from "@thenavidm/slipway";

import { PythonBridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { PhotosError } from "./errors.js";
import { TOOLS } from "./tools/index.js";
import type { ToolContext } from "./tools/kit.js";
import { VERSION } from "./version.js";

const INSTRUCTIONS = `Tools for the user's own Apple Photos library, read directly on this Mac. Nothing is uploaded anywhere.

How to actually find something:

1. search_photos first. It queries Apple's own on-device index across the whole library, so the match count is library-wide; \`limit\` caps what comes back, not what is searched.
2. Then look_at_photos on the top few. Search returns candidates, not answers, and filenames tell you nothing. Look before you describe, recommend or choose.
3. Only then reply, naming the file and the date so the user can find it.

Three things that prevent confident wrong answers:

- For anything about scale or proportion, call library_stats. It gives real totals in one call. Counting by running searches and reading results double-counts overlapping terms and cannot see the items that carry no place or label, which in a typical library is thousands.
- Apple's visual vocabulary is closed, about 1,500 words. If a result carries \`unmatched_terms\`, Apple has never heard of that word and rephrasing the same idea will not help. Read \`did_you_mean\`, or call list_vocabulary.
- Screenshots are often a fifth of a library and skew every count. Use \`screenshots: "exclude"\` when the question is about photographs.

Nothing here can delete a photo; macOS does not permit it. archive_photos moves items into an album for the user to empty by hand, and it is the one tool that asks for confirmation.`;

/**
 * The engine's own doctor: macOS, Python, Full Disk Access, the library, its
 * index and the write switches, each as one check. When the engine cannot even
 * start, that is the one check, with how to fix it.
 */
async function doctor({ bridge }: ToolContext): Promise<DoctorCheck[]> {
  try {
    const result = await bridge.call("doctor", {});
    const report = JSON.parse(result.text) as { checks?: Array<{ check: string; ok: boolean; detail: string; fix?: string }> };
    return (report.checks ?? []).map((check) => ({ name: check.check, ok: check.ok, detail: check.detail, ...(check.fix ? { fix: check.fix } : {}) }));
  } catch (error) {
    // The message carries the advice, which goes in fix; the cause is its first sentence and the engine's own words.
    const cause = (error as Error).message.split(/(?<=`)\. /)[0] ?? (error as Error).message;
    const detail = error instanceof PhotosError && error.detail ? `${cause}: ${error.detail.split("\n")[0]}` : cause;
    return [
      {
        name: "Photos engine",
        ok: false,
        detail,
        fix: "Install uv (https://docs.astral.sh/uv/) or set APPLE_PHOTOS_PYTHON to a Python that has osxphotos and photoscript.",
      },
    ];
  }
}

/** 1.1's spellings for the refs and the folder, which `which` and help still accept. */
const FLAG_ALIASES: Record<string, string> = {
  uuid: "refs",
  uuids: "refs",
  ref: "refs",
  file: "refs",
  files: "refs",
  out: "directory",
  dir: "directory",
  n: "limit",
};

/** The words people use for what the tools call something else, as 1.1's `which` read them. */
const SYNONYMS: Record<string, string[]> = {
  save: ["export", "originals"],
  saving: ["export", "originals"],
  download: ["export", "originals"],
  copy: ["export", "originals"],
  disk: ["export", "originals"],
  file: ["export", "originals"],
  files: ["export", "originals"],
  find: ["search"],
  show: ["search", "look"],
  see: ["look"],
  view: ["look"],
  preview: ["look"],
  image: ["photos"],
  images: ["photos"],
  picture: ["photos"],
  pictures: ["photos"],
  pic: ["photos"],
  pics: ["photos"],
  video: ["photos"],
  videos: ["photos"],
  tag: ["keywords"],
  tags: ["keywords"],
  label: ["keywords"],
  labels: ["keywords"],
  caption: ["description"],
  name: ["title"],
  heart: ["favourite", "favorite"],
  star: ["favourite", "favorite"],
  like: ["favourite", "favorite"],
  delete: ["archive"],
};

export type AppOptions = {
  /** Replace how calls reach the engine, for tests that stand a fake one in. */
  context?: (env: NodeJS.ProcessEnv) => ToolContext;
};

export function createApp(options: AppOptions = {}) {
  return slipway<ToolContext>({
    name: "apple-photos",
    title: "Apple Photos",
    version: VERSION,
    package: "@thenavidm/apple-photos-mcp-cli",
    envPrefix: "APPLE_PHOTOS",
    description: "Search, look at and organize the Apple Photos library on this Mac, through Apple's own on-device index. Nothing is uploaded.",
    instructions: INSTRUCTIONS,
    context:
      options.context ??
      ((env) => {
        const config = loadConfig(env);
        return { config, bridge: new PythonBridge(config) };
      }),
    // Nothing to sign in to: macOS decides who may read the library, and doctor says whether it lets this.
    configured: () => true,
    tools: TOOLS,
    doctor,
    // The checks are the engine's, on this Mac, so they run on every doctor rather than only with --network.
    doctorNetwork: true,
    flagAliases: FLAG_ALIASES,
    synonyms: SYNONYMS,
    login:
      "There is no sign-in: the library is on this Mac, and macOS decides who may read it. The first run asks for permission; if it is refused, give the app that launches this server Full Disk Access, then run apple-photos-cli doctor.",
    settings: [
      { env: "APPLE_PHOTOS_PYTHON", description: "A Python that has osxphotos and photoscript; uv fetches them on demand when unset." },
      { env: "APPLE_PHOTOS_LIBRARY", description: "Another Photos library; the system library when unset." },
      { env: "APPLE_PHOTOS_EXPORT_DIR", description: "Where export_originals writes; ~/Downloads/Photos Exports when unset." },
      { env: "APPLE_PHOTOS_ARCHIVE_ALBUM", description: "The album archive_photos moves items into." },
      { env: "APPLE_PHOTOS_PYTHONPATH", description: "Where the engine's package lives; the copy shipped with this package when unset.", tuning: true },
      { env: "APPLE_PHOTOS_STARTUP_TIMEOUT_MS", description: "How long the engine may take to start; 300000, since a cold uv run builds pyobjc.", tuning: true },
      { env: "APPLE_PHOTOS_REQUEST_TIMEOUT_MS", description: "How long one call may take; 300000.", tuning: true },
      { env: "APPLE_PHOTOS_PREVIEW_DIR", description: "Where look_at_photos renders previews.", tuning: true },
      { env: "APPLE_PHOTOS_PREVIEW_PX", description: "The default preview size in pixels.", tuning: true },
      { env: "APPLE_PHOTOS_PREVIEW_MAX", description: "How many previews one call renders.", tuning: true },
      { env: "APPLE_PHOTOS_WRITE_BATCH_MAX", description: "How many items one write may touch.", tuning: true },
    ],
    links: { repository: "https://github.com/thenavidm/apple-photos-mcp-cli" },
  });
}

export const app = createApp();
