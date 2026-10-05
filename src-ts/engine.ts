/**
 * Just enough of an MCP client to talk to the Python engine over stdio.
 *
 * The engine is an MCP server, and this layer only ever starts it, calls a
 * tool and lists its tools. Those are three requests in newline-delimited
 * JSON-RPC, so they need a few dozen lines rather than the MCP SDK's client,
 * whose package brought a web framework and its dependencies along with it.
 *
 * What the engine asks of a client is answered the way the SDK's client would:
 * a ping gets an empty result, and anything else gets "method not found",
 * because this client offers no roots, sampling or forms.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type Message = {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** The protocol revision the engine's Python MCP server speaks. */
const PROTOCOL = "2025-06-18";

export type EngineOptions = {
  command: string;
  args: string[];
  env: Record<string, string>;
  clientInfo: { name: string; version: string };
  /** Each chunk the engine writes to stderr. It must be read, or a chatty engine blocks on a full pipe. */
  onStderr?: (chunk: string) => void;
  /** The engine exited or could not start. */
  onClose?: () => void;
};

export class StdioEngine {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  constructor(private readonly options: EngineOptions) {}

  /** Start the engine and complete the handshake, or reject with why it would not start. */
  async start(timeoutMs: number): Promise<void> {
    const child = spawn(this.options.command, this.options.args, { env: this.options.env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.read(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.options.onStderr?.(chunk.toString()));
    // A missing command arrives as an error event, an engine that dies as an exit;
    // both fail whatever was waiting, so nothing hangs on a process that is gone.
    child.on("error", (error) => this.fail(error));
    child.on("close", (code, signal) => this.fail(new Error(`The engine exited${code === null ? ` on ${signal}` : ` with code ${code}`}.`)));
    // The engine outlives nothing: it goes when this process does.
    process.once("exit", () => this.child?.kill());

    await this.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: this.options.clientInfo }, timeoutMs);
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** One request, answered or failed within `timeoutMs`. A timeout tells the engine to stop. */
  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("The engine is not running."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "timed out" } });
        reject(new Error(`${method} got no answer from the engine within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Stop the engine: closing stdin is how an MCP stdio server is told to go. */
  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.stdin.end();
    const gone = new Promise<void>((resolve) => child.once("close", () => resolve()));
    const grace = setTimeout(() => child.kill(), 2000);
    await gone;
    clearTimeout(grace);
  }

  private send(message: Message): void {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        continue; // Not protocol: a stray print from a library. stdout is the engine's to keep clean.
      }
      this.dispatch(message);
    }
  }

  private dispatch(message: Message): void {
    if (message.method !== undefined) {
      // A request from the engine, which needs an answer; a notification, which does not.
      if (message.id === undefined) return;
      if (message.method === "ping") this.send({ jsonrpc: "2.0", id: message.id, result: {} });
      else this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `This client does not answer ${message.method}.` } });
      return;
    }
    if (typeof message.id !== "number") return;
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    this.options.onClose?.();
  }
}
