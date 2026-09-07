import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  WorkerMessageSearchRequestSchema,
  WorkerMessageReactionRequestSchema,
  AgentAppInboxAckCommandSchema,
  AgentMemoryConfigSnapshotSchema,
  MAX_ATTACHMENT_BYTES,
  WorkerArtifactPrepareRequestSchema,
  WorkerArtifactUploadSchema,
  WorkerReminderCancelRequestSchema,
  WorkerReminderListRequestSchema,
  WorkerReminderLogRequestSchema,
  WorkerReminderScheduleRequestSchema,
  WorkerReminderSnoozeRequestSchema,
  WorkerReminderUpdateRequestSchema,
  WorkerTaskSubmitRequestSchema,
} from "@rah-os/protocol";
import { parseAgentAppConfig } from "./agent-app-config-cli.ts";

const MAX_TOKEN_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const MAX_ARGUMENT_BYTES = 64 * 1_024;
const REQUEST_TIMEOUT_MS = 30_000;
const ARTIFACT_REQUEST_TIMEOUT_MS = 120_000;

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
    (arguments_.length === 2 &&
      arguments_[0] === "reminder" &&
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
    const artifact =
      arguments_[0] === "worker" && arguments_[1] === "artifact-publish";
    const artifactDownload =
      arguments_[0] === "worker" && arguments_[1] === "artifact-download";
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
    if (artifact) {
      const result = await publishWorkerArtifact(arguments_, {
        origin,
        runtime,
        send,
        token,
      });
      runtime.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (artifactDownload) {
      const result = await downloadWorkerArtifact(arguments_, {
        origin,
        runtime,
        token,
      });
      runtime.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    const request = config
      ? { path: "/v1/agent-config/get", body: {} }
      : inbox
        ? parseAgentInboxCommand(arguments_)
        : arguments_[0] === "reminder"
          ? parseReminderCommand(arguments_)
          : parseCommand(arguments_);
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

async function publishWorkerArtifact(
  arguments_: readonly string[],
  context: {
    origin: string;
    runtime: WorkerCliRuntime;
    send: (request: { path: string; body: unknown }) => Promise<unknown>;
    token: string;
  },
) {
  const options = parseOptions(arguments_.slice(2));
  assertAllowed(options, [
    "filename",
    "idempotency-key",
    "mime-type",
    "path",
    "task-id",
  ]);
  const sourcePath = resolve(boundedText(options, "path", 4_096));
  let handle;
  try {
    handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAX_ATTACHMENT_BYTES ||
      !Number.isSafeInteger(metadata.size)
    ) {
      throw new Error(
        `artifact must be a regular file between 1 and ${String(MAX_ATTACHMENT_BYTES)} bytes`,
      );
    }
    const prepared = WorkerArtifactUploadSchema.parse(
      await context.send({
        path: "/v1/worker/artifacts/prepare",
        body: WorkerArtifactPrepareRequestSchema.parse({
          filename: options.filename ?? basename(sourcePath),
          idempotencyKey: boundedText(options, "idempotency-key", 512),
          mimeType: options["mime-type"] ?? "application/octet-stream",
          size: metadata.size,
          taskId: boundedText(options, "task-id", 512),
        }),
      }),
    );
    if (prepared.state !== "pending") {
      if (prepared.state === "completed" || prepared.state === "consumed") {
        return prepared;
      }
      throw new Error(
        `artifact reservation cannot upload from state ${prepared.state}`,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Worker artifact upload timed out")),
      ARTIFACT_REQUEST_TIMEOUT_MS,
    );
    try {
      const body = Readable.toWeb(
        handle.createReadStream({ autoClose: false, start: 0 }),
      );
      const response = await context.runtime.fetch(
        `${context.origin}/v1/worker/artifacts/${prepared.attachmentId}`,
        {
          body: body as RequestInit["body"],
          duplex: "half",
          headers: {
            authorization: `Bearer ${context.token}`,
            "content-type": "application/octet-stream",
          },
          method: "PUT",
          signal: controller.signal,
        } as RequestInit & { duplex: "half" },
      );
      const result = await readBoundedJson(response.body);
      if (!response.ok) {
        throw new Error(serverErrorMessage(result, response.status));
      }
      return WorkerArtifactUploadSchema.parse(result);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new Error(
        "artifact path must reference a regular non-symlink file",
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function downloadWorkerArtifact(
  arguments_: readonly string[],
  context: {
    origin: string;
    runtime: WorkerCliRuntime;
    token: string;
  },
) {
  const options = parseOptions(arguments_.slice(2));
  assertAllowed(options, ["attachment-id", "output"]);
  const attachmentId = boundedText(options, "attachment-id", 512);
  const output = resolve(boundedText(options, "output", 4_096));
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Worker artifact download timed out")),
    ARTIFACT_REQUEST_TIMEOUT_MS,
  );
  let handle;
  try {
    const response = await context.runtime.fetch(
      `${context.origin}/v1/worker/artifacts/${attachmentId}`,
      {
        headers: { authorization: `Bearer ${context.token}` },
        method: "GET",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const result = await readBoundedJson(response.body);
      throw new Error(serverErrorMessage(result, response.status));
    }
    if (response.body === null) {
      throw new Error("Worker artifact response had no body");
    }
    handle = await open(
      output,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_WRONLY,
      0o600,
    );
    const reader = response.body.getReader();
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_ATTACHMENT_BYTES) {
        await reader.cancel("Worker artifact download exceeded its limit");
        throw new Error("Worker artifact download exceeded its limit");
      }
      let offset = 0;
      while (offset < next.value.byteLength) {
        const wrote = await handle.write(
          next.value,
          offset,
          next.value.byteLength - offset,
        );
        if (wrote.bytesWritten <= 0) {
          throw new Error("Worker artifact download write made no progress");
        }
        offset += wrote.bytesWritten;
      }
    }
    return { attachmentId, output };
  } catch (error) {
    await handle?.close().catch(() => {});
    handle = undefined;
    await unlink(output).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    await handle?.close();
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
  const options = parseOptions(
    arguments_.slice(2),
    command === "message-post" ? ["anyway", "send-draft"] : [],
  );
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
    case "message-search":
      assertAllowed(options, ["query", "limit", "cursor"]);
      return {
        path: "/v1/worker/messages/search",
        body: WorkerMessageSearchRequestSchema.parse({
          query: boundedText(options, "query", 500),
          ...(options.limit === undefined
            ? {}
            : { limit: positiveInteger(options, "limit") }),
          ...(options.cursor === undefined
            ? {}
            : { cursor: boundedText(options, "cursor", 2048) }),
        }),
      };
    case "message-react":
      assertAllowed(options, [
        "message-id",
        "emoji",
        "active",
        "based-on-room-seq",
        "idempotency-key",
      ]);
      if (options.active !== "true" && options.active !== "false")
        throw new Error("--active must be true or false");
      return {
        path: "/v1/worker/messages/react",
        body: WorkerMessageReactionRequestSchema.parse({
          messageId: boundedText(options, "message-id", 512),
          emoji: boundedText(options, "emoji", 64),
          active: options.active === "true",
          basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
          idempotencyKey: boundedText(options, "idempotency-key", 200),
        }),
      };
    case "message-post":
      assertAllowed(options, [
        "anyway",
        "based-on-room-seq",
        "body",
        "held-draft-id",
        "idempotency-key",
        "send-draft",
      ]);
      if (options["send-draft"] === "true") {
        if (options.body !== undefined) {
          throw new Error("--body cannot be combined with --send-draft");
        }
        return {
          body: {
            ...(options.anyway === "true" ? { anyway: true } : {}),
            basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
            heldDraftId: boundedText(options, "held-draft-id", 512),
            idempotencyKey: boundedText(options, "idempotency-key", 512),
            sendDraft: true,
          },
          path: "/v1/worker/messages/post",
        };
      }
      if (options.anyway !== undefined) {
        throw new Error("--anyway requires --send-draft");
      }
      if (options["held-draft-id"] !== undefined) {
        throw new Error("--held-draft-id requires --send-draft");
      }
      return {
        body: {
          basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
          body: boundedText(options, "body"),
          idempotencyKey: boundedText(options, "idempotency-key", 512),
        },
        path: "/v1/worker/messages/post",
      };
    case "thread-unfollow":
      assertAllowed(options, [
        "based-on-room-seq",
        "idempotency-key",
        "thread-id",
      ]);
      return {
        body: {
          basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
          idempotencyKey: boundedText(options, "idempotency-key", 512),
          threadId: boundedText(options, "thread-id", 512),
        },
        path: "/v1/worker/threads/unfollow",
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
    case "task-trajectory": {
      assertAllowed(options, ["before-sequence", "limit", "task-id"]);
      return {
        body: {
          taskId: boundedText(options, "task-id", 512),
          ...(options["limit"] === undefined
            ? {}
            : { limit: positiveInteger(options, "limit") }),
          ...(options["before-sequence"] === undefined
            ? {}
            : { beforeSequence: positiveInteger(options, "before-sequence") }),
        },
        path: "/v1/worker/tasks/trajectory",
      };
    }
    case "task-submission":
      return taskQuery(options, "/v1/worker/tasks/submission");
    case "task-input-status":
      return taskQuery(options, "/v1/worker/tasks/input-status");
    case "task-create": {
      assertAllowed(options, [
        "assignee",
        "based-on-room-seq",
        "idempotency-key",
        "title",
      ]);
      const assignee = options["assignee"];
      return {
        body: {
          basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
          idempotencyKey: boundedText(options, "idempotency-key", 512),
          title: boundedText(options, "title", 2_000),
          ...(assignee === undefined
            ? {}
            : { assigneeId: boundedText(options, "assignee", 512) }),
        },
        path: "/v1/worker/tasks/create",
      };
    }
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
      return taskSubmitMutation(options);
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

function parseReminderCommand(arguments_: readonly string[]): {
  body: Record<string, unknown>;
  path: string;
} {
  const action = arguments_[1];
  if (arguments_[0] !== "reminder" || action === undefined) {
    throw new Error("usage: rah reminder <command> [options]");
  }
  const options = parseOptions(arguments_.slice(2), ["all"]);
  const idempotencyKey = () =>
    options["idempotency-key"] ?? `reminder-command-${randomUUID()}`;
  if (action === "schedule") {
    assertAllowed(options, [
      "based-on-room-seq",
      "channel",
      "delay-seconds",
      "fire-at",
      "idempotency-key",
      "message-id",
      "msg-id",
      "payload-json",
      "repeat",
      "title",
      "tz",
    ]);
    const messageId = options["message-id"]?.trim();
    const legacyMessageId = options["msg-id"]?.trim();
    if (
      messageId !== undefined &&
      legacyMessageId !== undefined &&
      messageId !== legacyMessageId
    ) {
      throw new Error(
        "Pass only one message anchor; --msg-id is a deprecated alias for --message-id",
      );
    }
    return {
      body: WorkerReminderScheduleRequestSchema.parse({
        basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
        ...(options.channel === undefined
          ? {}
          : { channel: boundedText(options, "channel", 512) }),
        ...(options["fire-at"] === undefined
          ? {}
          : { fireAt: isoTimestamp(options, "fire-at") }),
        idempotencyKey: idempotencyKey(),
        ...(options["delay-seconds"] === undefined
          ? {}
          : {
              delaySeconds: positiveInteger(options, "delay-seconds"),
            }),
        messageId:
          messageId ??
          legacyMessageId ??
          boundedText(options, "message-id", 512),
        ...(options["payload-json"] === undefined
          ? {}
          : { payload: jsonObjectOption(options, "payload-json") }),
        ...(options.repeat === undefined
          ? {}
          : { repeat: boundedText(options, "repeat", 256) }),
        ...(options.repeat === undefined
          ? options.tz === undefined
            ? {}
            : { timezone: boundedText(options, "tz", 256) }
          : {
              timezone:
                options.tz === undefined
                  ? Intl.DateTimeFormat().resolvedOptions().timeZone
                  : boundedText(options, "tz", 256),
            }),
        title: boundedText(options, "title", 2_000),
      }),
      path: "/v1/worker/reminders/schedule",
    };
  }
  if (action === "list") {
    assertAllowed(options, ["all", "status"]);
    return {
      body: WorkerReminderListRequestSchema.parse({
        ...(options.all === "true" ? { all: true } : {}),
        ...(options.status === undefined
          ? {}
          : {
              statuses: boundedText(options, "status", 64)
                .split(",")
                .map((status) => status.trim())
                .filter(Boolean),
            }),
      }),
      path: "/v1/worker/reminders/list",
    };
  }
  if (action === "log") {
    assertAllowed(options, ["id"]);
    return {
      body: WorkerReminderLogRequestSchema.parse({
        reminderId: boundedText(options, "id", 512),
      }),
      path: "/v1/worker/reminders/log",
    };
  }
  if (action === "cancel") {
    assertAllowed(options, ["id", "idempotency-key"]);
    return {
      body: WorkerReminderCancelRequestSchema.parse({
        idempotencyKey: idempotencyKey(),
        reminderId: boundedText(options, "id", 512),
      }),
      path: "/v1/worker/reminders/cancel",
    };
  }
  if (action === "snooze") {
    assertAllowed(options, ["by", "id", "idempotency-key"]);
    return {
      body: WorkerReminderSnoozeRequestSchema.parse({
        delaySeconds: durationSeconds(options, "by"),
        idempotencyKey: idempotencyKey(),
        reminderId: boundedText(options, "id", 512),
      }),
      path: "/v1/worker/reminders/snooze",
    };
  }
  if (action === "update") {
    assertAllowed(options, [
      "cadence",
      "fire-at",
      "id",
      "idempotency-key",
      "in",
      "title",
      "tz",
    ]);
    return {
      body: WorkerReminderUpdateRequestSchema.parse({
        ...(options["fire-at"] === undefined
          ? {}
          : { fireAt: isoTimestamp(options, "fire-at") }),
        idempotencyKey: idempotencyKey(),
        ...(options.in === undefined
          ? {}
          : { delaySeconds: durationSeconds(options, "in") }),
        reminderId: boundedText(options, "id", 512),
        ...(options.cadence === undefined
          ? {}
          : { repeat: boundedText(options, "cadence", 256) }),
        ...(options.title === undefined
          ? {}
          : { title: boundedText(options, "title", 2_000) }),
        ...(options.cadence === undefined
          ? options.tz === undefined
            ? {}
            : { timezone: boundedText(options, "tz", 256) }
          : {
              timezone:
                options.tz === undefined
                  ? Intl.DateTimeFormat().resolvedOptions().timeZone
                  : boundedText(options, "tz", 256),
            }),
      }),
      path: "/v1/worker/reminders/update",
    };
  }
  throw new Error(`unknown Reminder command: ${action}`);
}

function durationSeconds(
  options: Readonly<Record<string, string>>,
  name: string,
): number {
  const source = boundedText(options, name, 64);
  const match = /^([1-9][0-9]*)([smhd])?$/u.exec(source);
  if (match === null) {
    throw new Error(
      `--${name} must be a positive duration like 30m, 2h, or 1d`,
    );
  }
  const multiplier =
    match[2] === undefined || match[2] === "s"
      ? 1
      : match[2] === "m"
        ? 60
        : match[2] === "h"
          ? 3_600
          : 86_400;
  const seconds = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`--${name} is too large`);
  }
  return seconds;
}

function isoTimestamp(
  options: Readonly<Record<string, string>>,
  name: string,
): string {
  const source = boundedText(options, name, 128);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`--${name} must be an ISO timestamp`);
  }
  return new Date(milliseconds).toISOString();
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

function taskSubmitMutation(options: Readonly<Record<string, string>>): {
  body: Record<string, unknown>;
  path: string;
} {
  assertAllowed(options, [
    "based-on-room-seq",
    "idempotency-key",
    "summary",
    "task-id",
    "verification-artifact-ids",
    "verification-status",
    "verification-summary",
  ]);
  const hasVerification =
    options["verification-artifact-ids"] !== undefined ||
    options["verification-status"] !== undefined ||
    options["verification-summary"] !== undefined;
  const verificationStatus = options["verification-status"];
  if (
    hasVerification &&
    verificationStatus !== "passed" &&
    verificationStatus !== "failed" &&
    verificationStatus !== "not_run"
  ) {
    throw new Error(
      "--verification-status must be passed, failed, or not_run when verification is declared",
    );
  }
  return {
    body: WorkerTaskSubmitRequestSchema.parse({
      basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
      idempotencyKey: boundedText(options, "idempotency-key", 512),
      summary: boundedText(options, "summary"),
      taskId: boundedText(options, "task-id", 512),
      ...(hasVerification
        ? {
            verification: {
              artifactIds:
                options["verification-artifact-ids"] === undefined
                  ? []
                  : boundedText(options, "verification-artifact-ids", 5_120)
                      .split(",")
                      .map((artifactId) => artifactId.trim())
                      .filter(Boolean),
              status: verificationStatus,
              summary: boundedText(options, "verification-summary"),
            },
          }
        : {}),
    }),
    path: "/v1/worker/tasks/submit",
  };
}

function parseOptions(
  arguments_: readonly string[],
  booleanFlags: readonly string[] = [],
): Record<string, string> {
  const flags = new Set(booleanFlags);
  const options: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index]!;
    if (!option.startsWith("--") || option.length <= 2) {
      throw new Error(`invalid Worker option: ${option}`);
    }
    const name = option.slice(2);
    if (Object.hasOwn(options, name)) {
      throw new Error(`duplicate Worker option: --${name}`);
    }
    if (flags.has(name)) {
      options[name] = "true";
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Worker option --${name} requires one value`);
    }
    options[name] = value;
    index += 1;
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
rah reminder schedule --title TEXT (--delay-seconds N|--fire-at ISO|--repeat RULE) --message-id ID --based-on-room-seq N [--channel #ROOM] [--tz IANA]
rah reminder list [--status scheduled,fired,canceled|--all]
rah reminder cancel --id ID
rah reminder snooze --id ID --by 30m
rah reminder update --id ID (--in 30m|--fire-at ISO|--cadence RULE|--title TEXT) [--tz IANA]
rah reminder log --id ID
rah worker sync [--after-seq N]
rah worker acknowledge --through-seq N
rah worker message-search --query TEXT [--limit N] [--cursor CURSOR]
rah worker message-react --message-id ID --emoji EMOJI --active true|false --based-on-room-seq N --idempotency-key KEY
rah worker message-post --body TEXT --based-on-room-seq N --idempotency-key KEY
rah worker message-post --send-draft --held-draft-id ID [--anyway] --based-on-room-seq N --idempotency-key KEY
rah worker thread-unfollow --thread-id ID --based-on-room-seq N --idempotency-key KEY
rah worker artifact-publish --task-id ID --path FILE [--filename NAME] [--mime-type TYPE] --idempotency-key KEY
rah worker artifact-download --attachment-id ID --output FILE
rah worker mcp-tools
rah worker mcp-call --server-id ID --tool-name NAME --config-version N --assignment-version N --arguments-json JSON_OBJECT
rah worker task-get --task-id ID
rah worker task-submission --task-id ID
rah worker task-trajectory --task-id ID [--limit N] [--before-sequence N]
Reviewers read the owner's recorded commands and file edits before recording a Review.
rah worker task-input-status --task-id ID
rah worker task-create --title TEXT [--assignee PARTICIPANT_ID] --based-on-room-seq N --idempotency-key KEY
rah worker task-claim-message --message-id ID --rationale TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-claim|task-start|task-release --task-id ID --based-on-room-seq N --idempotency-key KEY
rah worker task-progress --task-id ID --progress TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-block --task-id ID --reason TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-request-input --task-id ID --question TEXT --based-on-room-seq N --idempotency-key KEY
rah worker task-submit --task-id ID --summary TEXT [--verification-status passed|failed|not_run --verification-summary TEXT --verification-artifact-ids ID,ID] --based-on-room-seq N --idempotency-key KEY
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
