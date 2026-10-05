# Changelog

## Versions

| Component | Version | Checked |
|---|---|---|
| `mcp` (Python SDK) | 2.x, with a 1.x fallback | 2026-09-01 |
| `osxphotos` | 0.76.1 | 2026-09-01 |
| `photoscript` | 0.3.x | 2026-09-01 |
| Photos library schema | DB 5001, model 19607, Photos 11.1 | 2026-09-01 |
| Python | 3.11, 3.12, 3.13 | 2026-09-01 |
| Node (TypeScript surface) | 22+ | 2026-10-05 |
| `@thenavidm/slipway` | 0.1.24 | 2026-10-05 |

## 2.0.0, 2026-10-05

The TypeScript surface is built on [Slipway](https://github.com/thenavidm/slipway) 0.1.24; the Python engine is unchanged. The 13 tools keep their names and arguments, and `ALL_TOOLS` keeps the shape the HQ connector imports. Every difference below was measured against 1.1.1, the last version on npm, with an empty home folder and an engine that cannot start, so no measurement read the library.

- **`<command> --help` shows that command.** In 1.1.1 it printed the general help, so an agent looking for a command's flags tried `schema`, `help <command>`, `-h` and the bare command in turn. In Codex 0.159.3, finding the command that exports original files to a folder, and its flags, took a median of 53,232 input tokens over the CLI instead of 191,767 (five runs each): two commands in every 2.0.0 run, seven to ten in every 1.1.1 run.
- **A person approves an archive over MCP.** `archive_photos` still needs confirmation. Claude Code (2.1.246 and later) shows its own prompt, and a client that can show forms asks with an approval form whose one box starts unticked. Where a client can do neither, the model's `confirm: true` still counts, and `APPLE_PHOTOS_CONFIRM=model` makes it enough everywhere. The refusal keeps 1.1.1's words, "archive_photos cannot be undone from here", and the engine is told the call is confirmed only once it is.
- **`doctor` is the CLI's own,** and runs the engine's checks: macOS, Python, Full Disk Access, the library and its index, one line each, exiting 1 when one fails. The `doctor` tool keeps its name over MCP; on the CLI it is `check-setup`, since `doctor` is taken.
- **A smaller tool list.** Each tool no longer repeats `$schema` or an `execution` block saying it runs no background tasks, so the list is 2,586 o200k tokens instead of 3,016, and Claude Code 2.1.286 spends 3,402 tokens a message on it with every tool loaded instead of 3,843.
- **Less to install and start.** npx installs four packages instead of 94: the bridge to the Python engine now speaks MCP itself, in a few dozen lines, instead of through the MCP SDK's client, which brought a web framework with it. The server spends 145 ms of CPU before its first answer where 1.1.1 spent 158, and answers in 104 ms of wall time instead of 108 (median of 21 runs, taking turns on one Mac).
- **1.1.1's spellings still answer.** Several refs can be typed as bare words, `photo-info uuid1 uuid2 uuid3`; `--uuid`, `--file` and `--ref` mean `--refs` where a tool has no `ref` of its own; and `which` reads the same synonyms, so "save my photos to disk" still finds `export-originals`.
- **Exit codes as before**, with 1 now meaning an unexpected error: an engine that cannot start is 10, macOS refusing access 4, refs that resolve to nothing 3, a request over a cap 2, and anything else the engine reports 5.
- **`install <client>`** adds the server to Claude Code, Codex, Claude Desktop, Cursor, VS Code or Gemini CLI in each one's own format, and `--http` serves MCP over HTTP on 127.0.0.1, needing `APPLE_PHOTOS_HTTP_TOKEN` anywhere else.
- **Docs.** The README's costs are measured against 1.1.1, its settings table lists every variable, the contents links to sections 6, 7 and 10 work on GitHub, and `SKILL.md` lists `which` and exit code 1 and costs 2,490 tokens in Claude Code instead of 2,510.

What did not get better: over MCP, Codex's median rose from 39,915 input tokens to 39,959. Codex first asks with only the tools' names, identical for both versions, and then prints the tools: 2.0.0's printout was 53 characters shorter in every run. The medians differ by the length of the model's own replies.

### Upgrading

Node 22 or later is required; 1.1.1 ran on 20. Over MCP, expect an approval prompt or form before an archive; a headless agent that should archive with `confirm: true` alone needs `APPLE_PHOTOS_CONFIRM=model`. `apple-photos-cli doctor` prints one line per check, with `--json` for JSON, where 1.1.1 printed the engine's report; `apple-photos-cli check-setup` prints that report. An error in the terminal is one JSON object with `error`, Slipway's `code` and often a `hint`; over MCP an error is that JSON. The server now tells clients its name is `apple-photos`, where 1.1.1 said `apple-photos-mcp`. A missing argument's error is 15 tokens longer, for its code and a hint.

## 1.1.1, 2026-10-04

- **`npx -y @thenavidm/apple-photos-mcp-cli` always starts the MCP server.** npx starts whichever binary the npm registry lists first when they share one file, and the registry does not keep the published order, so an MCP client set up with this README's install line could get `apple-photos-cli` and its command list instead of a server. A third binary named after the package now always starts the server, and npx picks it by name.

## 1.1.0, 2026-09-26

- Exit codes follow the house contract, so a script branches the same way on every one of these CLIs: 0 ok, 2 typed wrong or a refused write, 3 not found, 4 macOS refused access (Full Disk Access, or Automation for Photos), 5 the engine or Photos failed, 10 the engine could not start. Before, everything that was not a typing mistake exited 1.
- SKILL.md carries the exit-code table.
- Releases come from `publish.yml` on a tag. The Claude Desktop extension is attached to each release.

## 1.0.4, 2026-09-03

Fixes found by a full review of the TypeScript surface.

- `look_at_photos` returned captions and no pictures. The bridge kept only text content parts, so the one tool whose purpose is seeing deleted every image before it reached the caller.
- Engine failures were reported as success. The Python returns its errors as an ordinary value, which the protocol marks `isError: false`, so a failed export exited 0 with the error on stdout and `export-originals ... && rm ...` would carry on.
- A crashed engine bricked the session. The dead client stayed cached, so every later call failed with "Connection closed" for the life of the process.
- The engine's stderr was piped and never read, which threw away the real cause of a failure and could block the child once the buffer filled.
- Timeouts were the protocol default of 60s, which a cold `uv` run and any real export both exceed.
- `uv run` now passes `--no-project`, so it stops trying to sync whatever project the client happened to be started in.
- `--refs` accepts several bare arguments: `photo-info uuid1 uuid2` used to be an error.
- Empty strings reach the engine, so a title or description can be cleared.
- `which` maps this library's vocabulary; "save my photos to disk" now answers `export-originals` rather than four browsing tools.
- Removed `login` and `capture` from the command list, and the Midjourney flag aliases and synonyms behind them. None of it existed here.
- `limit` caps at 100 and `size` at 128-2048, matching the engine instead of advertising ceilings it silently clamped. `photo_info` and `export_originals` say where they truncate.
- `export_originals` is a read: it copies files out without changing the library, which is why the engine offers it under read-only.
- `doctor` told users to set `APPLE_PHOTOS_MCP_LIBRARY`, which nothing reads. It is `APPLE_PHOTOS_LIBRARY`.
- Boolean environment variables are an allowlist on both sides, so `READ_ONLY=enabled` cannot mean read-only in one layer and read-write in the other.

## 1.0.2, 2026-09-02

- TypeScript MCP server and CLI over the Python engine, published as `@thenavidm/apple-photos-mcp-cli`. `npx` with no toolchain to install first, and every tool is also a shell command.
- The tool array is exported, so the HQ connector imports it rather than listing tools by hand. That route had drifted to 11 of 13, missing `library_stats` and `look_at_photos`, which meant a model estimated library totals from keyword samples and recommended photos it had never seen.
- A test asserts the TypeScript and Python tool lists match exactly.
- Python stays the engine: `osxphotos` and `photoscript` are the only libraries that can read a Photos library, and both are Python-only.
- Installs on any platform so tooling can read the schemas, and refuses to run anywhere but macOS with a message saying why.
- TypeScript output lives in `lib/`, not `dist/`. Python packaging leaves a `dist/.gitignore` containing `*`, which silently emptied the npm tarball.

## 0.1.0, 2026-09-01

First release.

Searches Apple's own on-device machine learning index rather than filenames and
typed metadata: scene labels, text read out of images, activities, venue types
and reverse geocoded places. Verified against a 37,129 item library where only
3 items had a title and 3 had keywords, but 35,983 carried scene labels and
10,852 carried readable text.

Ranking is tuned against the failure that matters. A screenshot full of OCR text
otherwise matches almost any query, so matches resting only on text found inside
an image are scored down, and screenshots compete at a discount unless the query
is asking for one.

Words Apple has no concept of come back in `unmatched_terms` with suggestions
from the vocabulary that does exist, instead of silently returning noise.

`look_at_photos` renders from Apple's cached derivatives rather than the
original, so previews work for assets that live only in iCloud. In the test
library 36,996 of 37,129 assets had no local original and every preview still
rendered.

Writes work by default. `archive_photos` requires `confirm: true`.
`APPLE_PHOTOS_READ_ONLY=1` removes the write tools from the list entirely.
