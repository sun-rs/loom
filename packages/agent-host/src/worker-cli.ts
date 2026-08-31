import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  AgentAppInboxAckCommandSchema,
  AgentMemoryConfigSnapshotSchema,
} from "@rah-os/protocol";
import { parseAgentAppConfig } from "./agent-app-config-cli.ts";

const MAX_TOKEN_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const MAX_ARGUMENT_BYTES = 64 * 1_024;
const REQUEST_TIMEOUT_MS = 30_000;

export type WorkerCliRuntime = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  fetch: (
    input: string,
    init: RequestInit,
  ) => Promise<Pick<Response, "body" | "ok" | "status">>;
  stderr: { write(value: string): unknown };
  stdout: { write(value: string): unknown };
}>;

export async function runWorkerCliCommand(
  arguments_: readonly string[],
  runtime: WorkerCliRuntime = {
    env: process.env,
    fetch: globalThis.fetch,
    stderr: process.stderr,
    stdout: process.stdout,
  },
): Promise<0 | 1> {
  if (
    (arguments_.length === 3 &&
      arguments_[0] === "agent" &&
      arguments_[1] === "inbox" &&
      ["help", "--help"].includes(arguments_[2]!)) ||
    (arguments_.length === 2 &&
      arguments_[0] === "worker" &&
      (arguments_[1] === "help" || arguments_[1] === "--help")) ||
    (arguments_.length === 1 && arguments_[0] === "--help")
  ) {
    runtime.stdout.write(help());
    return 0;
  }
  try {
    const config = arguments_[0] === "app";
    const mutation = config ? parseAgentAppConfig(arguments_) : undefined;
    const inbox = arguments_[0] === "agent" || config;
    const request = config
      ? { path: "/v1/agent-config/get", body: {} }
      : inbox
        ? parseAgentInboxCommand(arguments_)
        : parseCommand(arguments_);
    const origin = workerOrigin(
      inbox
        ? runtime.env.RAH_AGENT_INBOX_API_URL
        : runtime.env.RAH_WORKER_API_URL,
    );
    if (
      inbox &&
      (new URL(origin).protocol !== "http:" ||
        new URL(origin).hostname !== "127.0.0.1")
    )
      throw new Error(
        "Agent App Inbox must use a Computer-local loopback origin",
      );
    const token = await readWorkerToken(
      inbox
        ? runtime.env.RAH_AGENT_INBOX_SESSION_FILE
        : runtime.env.RAH_WORKER_SESSION_FILE,
    );
    const send = async (request: { path: string; body: unknown }) => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("Worker command timed out")),
        REQUEST_TIMEOUT_MS,
      );
      let response: Pick<Response, "body" | "ok" | "status">;
      try {
        response = await runtime.fetch(`${origin}${request.path}`, {
          body: JSON.stringify(request.body),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        });
        const result = await readBoundedJson(response.body);
        if (!response.ok) {
          throw new Error(serverErrorMessage(result, response.status));
        }
        return result;
      } finally {
        clearTimeout(timeout);
      }
    };
    let result = await send(request);
    if (mutation) {
      const current = AgentMemoryConfigSnapshotSchema.parse(result);
      result = await send({
        path: "/v1/agent-config/patch",
        body: { expectedRevision: current.revision, ...mutation },
      });
    }
    runtime.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    runtime.stderr.write(`rah: ${errorMessage(error)}\n`);
    return 1;
  }
}

function parseAgentInboxCommand(arguments_: readonly string[]) {
  if (arguments_[1] !== "inbox")
    throw new Error("usage: rah agent inbox check|ack");
  const options = parseOptions(arguments_.slice(3));
  if (arguments_[2] === "check" || arguments_[2] === "recheck") {
    assertAllowed(options, []);
    return { path: `/v1/agent-inbox/${arguments_[2]}`, body: {} };
  }
  if (arguments_[2] === "ack") {
    assertAllowed(options, ["item-id", "version"]);
    return {
      path: "/v1/agent-inbox/ack",
      body: AgentAppInboxAckCommandSchema.parse({
        itemId: boundedText(options, "item-id", 512),
        version: positiveInteger(options, "version"),
      }),
    };
  }
  throw new Error("usage: rah agent inbox check|ack");
}

function parseCommand(arguments_: readonly string[]): {
  body: Record<string, unknown>;
  path: string;
} {
  if (arguments_[0] !== "worker" || arguments_[1] === undefined) {
    throw new Error("usage: rah worker <command> [options]");
  }
  const command = arguments_[1];
  const options = parseOptions(arguments_.slice(2));
  switch (command) {
    case "sync":
      assertAllowed(options, ["after-seq"]);
      return {
        body:
          options["after-seq"] === undefined
            ? {}
            : { afterSeq: positiveInteger(options, "after-seq") },
        path: "/v1/worker/sync",
      };
    case "acknowledge":
      assertAllowed(options, ["through-seq"]);
      return {
        body: { throughSeq: positiveInteger(options, "through-seq") },
        path: "/v1/worker/acknowledge",
      };
    case "message-post":
      assertAllowed(options, ["based-on-room-seq", "body", "idempotency-key"]);
      return {
        body: {
          basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
          body: boundedText(options, "body"),
          idempotencyKey: boundedText(options, "idempotency-key", 512),
        },
        path: "/v1/worker/messages/post",
      };
    case "mcp-tools":
      assertAllowed(options, []);
      return { body: {}, path: "/v1/worker/mcp/tools" };
    case "mcp-call":
      assertAllowed(options, [
        "arguments-json",
        "assignment-version",
        "config-version",
        "server-id",
        "tool-name",
      ]);
      return {
        body: {
          arguments: jsonObjectOption(options, "arguments-json"),
          expectedAssignmentVersion: positiveInteger(
            options,
            "assignment-version",
          ),
          expectedConfigVersion: positiveInteger(options, "config-version"),
          mcpServerId: boundedText(options, "server-id", 512),
          toolName: boundedText(options, "tool-name", 512),
        },
        path: "/v1/worker/mcp/call",
      };
    case "task-get":
      return taskQuery(options, "/v1/worker/tasks/get");
    case "task-input-status":
      return taskQuery(options, "/v1/worker/tasks/input-status");
    case "task-claim-message":
      assertAllowed(options, [
        "based-on-room-seq",
        "idempotency-key",
        "message-id",
        "rationale",
      ]);
      return {
        body: {
          basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
          idempotencyKey: boundedText(options, "idempotency-key", 512),
          messageId: boundedText(options, "message-id", 512),
          rationale: boundedText(options, "rationale", 2_000),
        },
        path: "/v1/worker/tasks/claim-message",
      };
    case "task-claim":
      return taskMutation(options, "/v1/worker/tasks/claim");
    case "task-start":
      return taskMutation(options, "/v1/worker/tasks/start");
    case "task-release":
      return taskMutation(options, "/v1/worker/tasks/release");
    case "task-progress":
      return taskMutation(options, "/v1/worker/tasks/progress", "progress");
    case "task-block":
      return taskMutation(options, "/v1/worker/tasks/block", "reason");
    case "task-request-input":
      return taskMutation(
        options,
        "/v1/worker/tasks/request-input",
        "question",
      );
    case "task-submit":
      return taskMutation(options, "/v1/worker/tasks/submit", "summary");
    case "task-review": {
      assertAllowed(options, [
        "based-on-room-seq",
        "disposition",
        "idempotency-key",
        "summary",
        "task-id",
      ]);
      const disposition = boundedText(options, "disposition", 64);
      if (disposition !== "approved" && disposition !== "changes_requested") {
        throw new Error("--disposition must be approved or changes_requested");
      }
      return {
        body: {
          basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
          disposition,
          idempotencyKey: boundedText(options, "idempotency-key", 512),
          summary: boundedText(options, "summary"),
          taskId: boundedText(options, "task-id", 512),
        },
        path: "/v1/worker/tasks/review",
      };
    }
    default:
      throw new Error(`unknown Worker command: ${command}`);
  }
}

function jsonObjectOption(
  options: Readonly<Record<string, string>>,
  name: string,
): Record<string, unknown> {
  const source = boundedText(options, name);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`--${name} must be a bounded JSON object`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`--${name} must be a bounded JSON object`);
  }
  const pending: Array<{ depth: number; value: unknown }> = [
    { depth: 0, value },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > 10_000 || current.depth > 64) {
      throw new Error(`--${name} JSON structure is too complex`);
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    for (const child of Array.isArray(current.value)
      ? current.value
      : Object.values(current.value)) {
      pending.push({ depth: current.depth + 1, value: child });
    }
  }
  return value as Record<string, unknown>;
}

function taskQuery(
  options: Readonly<Record<string, string>>,
  path: string,
): { body: Record<string, unknown>; path: string } {
  assertAllowed(options, ["task-id"]);
  return { body: { taskId: boundedText(options, "task-id", 512) }, path };
}

function taskMutation(
  options: Readonly<Record<string, string>>,
  path: string,
  contentField?: "progress" | "question" | "reason" | "summary",
): { body: Record<string, unknown>; path: string } {
  assertAllowed(options, [
    "based-on-room-seq",
    "idempotency-key",
    "task-id",
    ...(contentField === undefined ? [] : [contentField]),
  ]);
  return {
    body: {
      basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
      idempotencyKey: boundedText(options, "idempotency-key", 512),
      taskId: boundedText(options, "task-id", 512),
      ...(contentField === undefined
        ? {}
        : { [contentField]: boundedText(options, contentField) }),
    },
    path,
  };
}

function parseOptions(arguments_: readonly string[]): Record<string, string> {
  if (arguments_.length % 2 !== 0) {
    throw new Error("every Worker option requires one value");
  }
  const options: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index]!;
    const value = arguments_[index + 1]!;
    if (!option.startsWith("--") || option.length <= 2) {
      throw new Error(`invalid Worker option: ${option}`);
    }
    const name = option.slice(2);
    if (Object.hasOwn(options, name)) {
      throw new Error(`duplicate Worker option: --${name}`);
    }
    options[name] = value;
  }
  return options;
}

function assertAllowed(
  options: Readonly<Record<string, string>>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const name of Object.keys(options)) {
    if (!allowedSet.has(name)) throw new Error(`unknown option: --${name}`);
  }
}

function boundedText(
  options: Readonly<Record<string, string>>,
  name: string,
  maximumBytes = MAX_ARGUMENT_BYTES,
): string {
  const value = options[name];
  if (
    value === undefined ||
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value) > maximumBytes
  ) {
    throw new Error(`--${name} must be a non-empty bounded value`);
  }
  return value;
}

function positiveInteger(
  options: Readonly<Record<string, string>>,
  name: string,
): number {
  const value = nonnegativeInteger(options, name);
  if (value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function nonnegativeInteger(
  options: Readonly<Record<string, string>>,
  name: string,
): number {
  const source = options[name];
  if (source === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(source)) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  const value = Number(source);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`--${name} must be a safe integer`);
  }
  return value;
}

async function readWorkerToken(path: string | undefined): Promise<string> {
  if (path === undefined || !isAbsolute(path) || path.includes("\0")) {
    throw new Error("RAH_WORKER_SESSION_FILE must be an absolute path");
  }
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAX_TOKEN_BYTES ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid())
    ) {
      throw new Error(
        "Worker token file must be an owner-private regular file",
      );
    }
    const buffer = Buffer.allocUnsafe(MAX_TOKEN_BYTES + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const result = await file.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        null,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > MAX_TOKEN_BYTES) {
      throw new Error("Worker token file exceeds the safe byte limit");
    }
    const token = buffer.subarray(0, offset).toString("utf8");
    if (token.length === 0 || /[\0\r\n]/u.test(token)) {
      throw new Error("Worker token file contains an invalid credential");
    }
    return token;
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new Error(
        "Worker token file must be an owner-private regular file",
      );
    }
    throw error;
  } finally {
    await file?.close();
  }
}

async function readBoundedJson(
  body: ReadableStream<Uint8Array> | null,
): Promise<unknown> {
  if (body === null) return {};
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new Error("Worker response exceeds the safe byte limit");
      }
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Worker response is not valid bounded JSON");
  }
}

function workerOrigin(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("RAH_WORKER_API_URL is missing");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RAH_WORKER_API_URL must be an HTTP(S) origin");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== value ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("RAH_WORKER_API_URL must be an HTTP(S) origin");
  }
  return value;
}

function serverErrorMessage(value: unknown, status: number): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "message" in value.error &&
    typeof value.error.message === "string" &&
    value.error.message.length <= 2_000
  ) {
    return `Worker API HTTP ${String(status)}: ${value.error.message}`;
  }
  return `Worker API HTTP ${String(status)}`;
}

function help(): string {
  return `rah app config --app system.cleaner [--set key=value] [--unset key]
rah agent inbox check
rah agent inbox recheck
rah agent inbox ack --item-id ID --version N
App Inbox ack confirms a notification, not successful memory cleanup or a Room/Task action.
rah worker sync [--after-seq N]
rah worker acknowledge --through-seq N
rah worker message-post --body TEXT --based-on-room-seq N --idempotency-key KEY
rah worker mcp-tools
rah worker mcp-call --server-id ID --tool-name NAME --config-version N --assignment-version N --arguments-json JSON_OBJECT
rah worker task-get --task-id ID
rah worker task-input-status --task-id ID
rah worker task-claim-message --message-id ID --rationale TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-claim|task-start|task-release --task-id ID --based-on-room-seq N --idempotency-key KEY
rah worker task-progress --task-id ID --progress TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-block --task-id ID --reason TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-request-input --task-id ID --question TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-submit --task-id ID --summary TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-review --task-id ID --disposition approved|changes_requested --summary TEXT --based-on-room-seq N --idempotency-key KEY
`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
