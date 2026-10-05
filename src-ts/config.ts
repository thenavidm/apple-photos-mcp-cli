/**
 * Everything read from the environment, in one place.
 *
 * There are no credentials here and there is nothing to configure to get
 * started: the library is on this Mac and macOS decides who may read it. The
 * only real setting is how to start Python.
 */

import { fileURLToPath } from "node:url";

export type Config = {
  pythonCommand: string;
  pythonArgs: string[];
  /** How long to wait for the engine to start. A cold `uv` run builds pyobjc. */
  startupTimeoutMs: number;
  /** Per-call deadline. Exports pull originals out of iCloud, so it is generous. */
  requestTimeoutMs: number;
  pythonEnv: Record<string, string>;
  exportDir?: string;
};

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function str(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  return raw && raw.trim() ? raw.trim() : undefined;
}

/**
 * Where the Python engine lives, resolved from this file rather than the
 * working directory.
 *
 * `src` relative to CWD works when you run from a clone and breaks everywhere
 * else, which is every `npx` install: the engine ships inside the package and
 * the caller is in their own project. dist/ sits one level under the package
 * root, so the engine is always ../src from here.
 */
function packagedEnginePath(): string {
  return fileURLToPath(new URL("../src", import.meta.url));
}

/**
 * The settings, read from `env`. Read-only mode, the switch for archiving and
 * the audit log are Slipway's now; the engine reads the same variables itself,
 * from the environment it inherits, and keeps its own guard.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `uv run --with ...` needs no virtualenv and caches after the first run, so
  // a reader with only Node installed still gets a working server.
  const explicit = str(env, "APPLE_PHOTOS_PYTHON");
  const pythonCommand = explicit ?? "uv";
  const pythonArgs = explicit
    ? ["-m", "apple_photos_mcp"]
    // `--no-project` matters: without it `uv run` discovers whatever
    // pyproject.toml sits above the client's working directory and tries to
    // sync that project instead. The engine is found via PYTHONPATH, so
    // project discovery is pure downside.
    : ["run", "--no-project", "--with", "osxphotos", "--with", "photoscript", "--with", "mcp", "python3", "-m", "apple_photos_mcp"];

  return {
    pythonCommand,
    pythonArgs,
    startupTimeoutMs: int(env, "APPLE_PHOTOS_STARTUP_TIMEOUT_MS", 300_000, 10_000, 1_800_000),
    requestTimeoutMs: int(env, "APPLE_PHOTOS_REQUEST_TIMEOUT_MS", 300_000, 5_000, 1_800_000),
    // The engine inherits this environment, so it reads the same settings, plus where its package is.
    pythonEnv: {
      ...(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string>),
      PYTHONPATH: str(env, "APPLE_PHOTOS_PYTHONPATH") ?? packagedEnginePath(),
    },
    exportDir: str(env, "APPLE_PHOTOS_EXPORT_DIR"),
  };
}

/** Every variable the code reads, so --help, the README and the tests agree. */
export const ENV_VARS = [
  "APPLE_PHOTOS_PYTHON",
  "APPLE_PHOTOS_PYTHONPATH",
  "APPLE_PHOTOS_STARTUP_TIMEOUT_MS",
  "APPLE_PHOTOS_REQUEST_TIMEOUT_MS",
  "APPLE_PHOTOS_READ_ONLY",
  "APPLE_PHOTOS_ALLOW_DESTRUCTIVE",
  "APPLE_PHOTOS_AUDIT_LOG",
  "APPLE_PHOTOS_EXPORT_DIR",
  // Read by the Python engine, forwarded through the inherited environment.
  "APPLE_PHOTOS_LIBRARY",
  "APPLE_PHOTOS_PREVIEW_DIR",
  "APPLE_PHOTOS_PREVIEW_PX",
  "APPLE_PHOTOS_PREVIEW_MAX",
  "APPLE_PHOTOS_WRITE_BATCH_MAX",
  "APPLE_PHOTOS_ARCHIVE_ALBUM",
] as const;
