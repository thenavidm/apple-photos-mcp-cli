#!/usr/bin/env node
// Stands in for the Python engine: an MCP server over stdio that answers the
// handshake and a few tools, so the bridge can be tested without Photos.
//   echo   returns its arguments as JSON text
//   image  returns a caption and an image, as look_at_photos does
//   fails  returns {"error": ...} in a successful result, as the engine reports failures
//   crash  exits mid-call
//   slow   never answers
// It also asks the client for a ping and for roots, which a client must answer.
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
const answered = new Map();

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id !== undefined && message.method === undefined) {
    answered.set(message.id, message.result ?? message.error);
    return;
  }
  if (message.method === "initialize") {
    send({ method: "notifications/message", params: { level: "info", data: "starting" } });
    send({ id: "ping-1", method: "ping" });
    send({ id: "roots-1", method: "roots/list" });
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-engine", version: "0" } } });
    return;
  }
  if (message.method === "tools/list") {
    send({ id: message.id, result: { tools: [{ name: "echo" }, { name: "image" }] } });
    return;
  }
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params;
    if (name === "echo") send({ id: message.id, result: text({ args, answered: Object.fromEntries(answered) }) });
    else if (name === "image") send({ id: message.id, result: { content: [{ type: "text", text: "IMG_1.jpg" }, { type: "image", data: "AAAA", mimeType: "image/jpeg" }] } });
    else if (name === "fails") send({ id: message.id, result: text({ error: "none of those refs resolved" }) });
    else if (name === "crash") process.exit(3);
    else if (name === "slow") return;
    else send({ id: message.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
  }
});
