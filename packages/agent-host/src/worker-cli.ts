import {
  MESSAGE_HEREDOC_DELIMITER,
  SEND_HELD_AS_DRAFT_MESSAGE,
  SEND_HELD_AS_DRAFT_NEXT_ACTION,
  formatDraftReplacedWarning,
  workerHeldSendGuidance,
  workerReplacedDraftBody,
  workerReplacedDraftNotice,
  workerSendSuccessOutput,
  workerTargetConfirmationBody,
  workerTargetConfirmationNextAction,
} from "./worker-held-send.ts";
import {
  WorkerCliError,
  cliError,
  markSendFailureDraftSaved,
  renderWorkerCliError,
  toWorkerCliError,
  workerServerFailureError,
} from "./worker-cli-error.ts";
import carrierPackage from "../package.json" with { type: "json" };
import { parseWorkerChannelAttentionCommand } from "./worker-channel-attention-cli.ts";
import {
  TASK_CARD_TRANSPORT_MAX_BYTES,
  ROOM_SYNC_RESPONSE_MAX_BYTES,
} from "@rah-os/protocol";
import { parseWorkerSelfProfileCommand } from "./worker-self-profile-cli.ts";
import { parseWorkerTaskManagementCommand } from "./worker-task-management-cli.ts";
import {
  REPEATED_VALUE_SEPARATOR,
  TASK_ADDRESS_OPTIONS,
  taskAddress,
  taskAddressList,
} from "./worker-task-address-cli.ts";
import { parseWorkerReadCommand } from "./worker-read-cli.ts";
import {
  renderWorkerReadResult,
  workerReadCommandOffersJson,
} from "./worker-read-render.ts";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  WorkerMessageReactionRequestSchema,
  AgentAppInboxAckCommandSchema,
  AgentMemoryConfigSnapshotSchema,
  MAX_ATTACHMENT_BYTES,
  PROFILE_IMAGE_MAX_BYTES,
  ProfileImageMimeTypeSchema,
  ProfileImageUploadResponseSchema,
  WorkerArtifactPrepareRequestSchema,
  WorkerArtifactUploadSchema,
  WorkerMessageAttachmentPrepareRequestSchema,
  WorkerMessageAttachmentUploadSchema,
  WorkerMessageAttachmentCancelRequestSchema,
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
const STDIN_FIRST_BYTE_WINDOW_MS = 250;
const ARTIFACT_REQUEST_TIMEOUT_MS = 120_000;

export type WorkerCliRuntime = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  fetch: (
    input: string,
    init: RequestInit,
  ) => Promise<Pick<Response, "body" | "ok" | "status">>;
  /** Raft reads message content from stdin; RAH keeps `--body` as a fallback. */
  stdin?: NodeJS.ReadableStream;
  stderr: { write(value: string): unknown };
  stdout: { write(value: string): unknown };
}>;

/**
 * Raft's `resolveSendContent`: the body arrives on stdin, bounded and UTF-8
 * decoded exactly like every other CLI input. A TTY or an unreadable stream is
 * treated as empty so a facade command can never block on a missing heredoc.
 */
async function readStdinText(
  runtime: WorkerCliRuntime,
  maximumBytes = MAX_ARGUMENT_BYTES,
): Promise<string> {
  const stream = runtime.stdin ?? process.stdin;
  if (
    stream === undefined ||
    (stream as { isTTY?: boolean }).isTTY === true ||
    (stream as { readable?: boolean }).readable === false
  )
    return "";
  const chunks = await new Promise<Buffer[]>((resolve, reject) => {
    const collected: Buffer[] = [];
    let total = 0;
    let settled = false;
    // An inherited stdin that never receives a heredoc must not block the
    // facade, so a first-byte window makes "no content" observable.
    const deadline = setTimeout(() => {
      if (collected.length === 0) settle(() => resolve([]));
    }, STDIN_FIRST_BYTE_WINDOW_MS);
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      stream.pause();
      finish();
    };
    function onData(chunk: Buffer | string) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maximumBytes) {
        settle(() =>
          reject(
            new Error(
              `message content on stdin must not exceed ${String(maximumBytes)} bytes`,
            ),
          ),
        );
        return;
      }
      collected.push(bytes);
    }
    function onEnd() {
      settle(() => resolve(collected));
    }
    function onError(error: unknown) {
      if (hasCode(error, "EAGAIN") || hasCode(error, "EOF")) {
        settle(() => resolve([]));
        return;
      }
      settle(() => reject(error));
    }
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
  if (text.includes("\0")) {
    throw new Error("message content on stdin must not contain NUL bytes");
  }
  return text;
}

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
  const sendCommand =
    arguments_[0] === "worker" && arguments_[1] === "message-post";
  // Raft's `--json` is an output selector, present on 19 of its 80 commands.
  // `message send` and `version` are the two of those RAH has ported; every
  // other command renders text only, exactly as upstream does.
  const jsonOutput = arguments_.includes("--json");
  let failureDraftSaved = false;
  try {
    const config = arguments_[0] === "app";
    const mutation = config ? parseAgentAppConfig(arguments_) : undefined;
    const inbox = arguments_[0] === "agent" || config;
    const artifact =
      arguments_[0] === "worker" &&
      [
        "artifact-publish",
        "attachment-publish",
        "profile-avatar-publish",
      ].includes(arguments_[1] ?? "");
    const artifactDownload =
      arguments_[0] === "worker" &&
      ["artifact-download", "attachment-download"].includes(
        arguments_[1] ?? "",
      );
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
        const result = await readBoundedJson(
          response.body,
          ["/v1/worker/sync", "/v1/worker/rooms/read"].includes(request.path)
            ? ROOM_SYNC_RESPONSE_MAX_BYTES
            : ["/v1/worker/tasks/amend", "/v1/worker/tasks/history"].includes(
                  request.path,
                )
              ? TASK_CARD_TRANSPORT_MAX_BYTES
              : MAX_RESPONSE_BYTES,
        );
        if (!response.ok) {
          throw workerServerFailureError(
            result,
            response.status,
            request.path === "/v1/worker/messages/post"
              ? "SEND_FAILED"
              : "READ_FAILED",
          );
        }
        return result;
      } finally {
        clearTimeout(timeout);
      }
    };
    if (artifact) {
      const result = await publishWorkerArtifact(
        arguments_,
        {
          origin,
          runtime,
          send,
          token,
        },
        arguments_[1] === "attachment-publish",
        arguments_[1] === "profile-avatar-publish",
      );
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
    // Raft's commander stage raises `INVALID_ARG` for every syntax and option
    // rejection (`main.js@30436161`). RAH's parsers are that stage, so a
    // rejection that carries no code of its own is an argument error, not an
    // internal bug; a parser that already chose a Raft code keeps it.
    const request = await parseWorkerRequest(async () =>
      config
        ? { path: "/v1/agent-config/get", body: {} }
        : inbox
          ? parseAgentInboxCommand(arguments_)
          : arguments_[0] === "reminder"
            ? parseReminderCommand(arguments_)
            : parseCommand(
                arguments_,
                arguments_[0] === "worker" &&
                  arguments_[1] === "message-post" &&
                  !arguments_.includes("--body")
                  ? await readStdinText(runtime)
                  : "",
              ),
    );
    const fanOut = (request as { bodies?: Record<string, unknown>[] }).bodies;
    if (fanOut !== undefined) {
      for (const body of fanOut) {
        const claimed = await send({ body, path: request.path });
        runtime.stdout.write(`${JSON.stringify(claimed)}\n`);
      }
      return 0;
    }
    const messagePost = request.path === "/v1/worker/messages/post";
    // Raft's `handleMessageSend` calls `setSavedDraft(...)` and then
    // `setFailureDraftSaved(true)` *before* awaiting the send, and skips both
    // for `--send-draft`. RAH's draft lives on the server and is written by the
    // same request, so the flag flips at the same point for the same reason:
    // from here on, a failure cannot tell the Agent whether its content
    // survived or was delivered.
    if (
      messagePost &&
      (request.body as { sendDraft?: unknown }).sendDraft !== true
    )
      failureDraftSaved = true;
    let result = await send(request);
    if (request.path === "/v1/worker/version")
      result = {
        ...(result as Record<string, unknown>),
        cliCarrier: {
          name: carrierPackage.name,
          version: carrierPackage.version,
        },
      };
    if (mutation) {
      const current = AgentMemoryConfigSnapshotSchema.parse(result);
      result = await send({
        path: "/v1/agent-config/patch",
        body: { expectedRevision: current.revision, ...mutation },
      });
    }
    // Raft's `writeText`/`writeJson` split, applied the way upstream applies it:
    // 76 of its 80 commands render human-readable text on stdout, and only 19
    // offer `--json` at all. A command with a ported renderer therefore prints
    // text unless it is one of the two that carry the flag and it was passed;
    // a command with no renderer yet keeps its JSON response.
    if (!messagePost) {
      const rendered =
        jsonOutput && workerReadCommandOffersJson(request.path)
          ? undefined
          : renderWorkerReadResult(request.path, request.body, result);
      runtime.stdout.write(
        rendered === undefined
          ? `${JSON.stringify(result)}\n`
          : `${rendered}\n`,
      );
      return 0;
    }
    const sendTarget = (request.body as { channel?: unknown }).channel;
    const displayTarget =
      typeof sendTarget === "string" ? sendTarget : undefined;
    const discarded = workerReplacedDraftBody(result);
    let text = "";
    if (discarded !== undefined) {
      const warned = displayTarget ?? "this target";
      runtime.stderr.write(
        `${formatDraftReplacedWarning(warned, discarded)}\n`,
      );
      text += workerReplacedDraftNotice(warned);
    }
    // Raft's rule for the two streams, applied per path rather than in bulk: a
    // rendered result goes to stdout, a raised error goes to stderr. The
    // freshness hold renders its bounded context first and then raises
    // (`handleMessageSend`: `if (!opts.json) writeText(...)` then `throw`), so
    // its body is stdout and its envelope is stderr. The thread-target
    // confirmation renders nothing and only raises, so all of it is stderr.
    const heldGuidance = workerHeldSendGuidance(result);
    if (heldGuidance !== undefined) {
      if (!jsonOutput) runtime.stdout.write(`${text}${heldGuidance}`);
      throw cliError("SEND_HELD_AS_DRAFT", SEND_HELD_AS_DRAFT_MESSAGE, {
        details: { held: result },
        draftSaved: true,
        effect: "draft_saved",
        outputMode: jsonOutput ? "json" : "text",
        retryable: false,
        suggestedNextAction: SEND_HELD_AS_DRAFT_NEXT_ACTION,
      });
    }
    const confirmationBody = workerTargetConfirmationBody(result);
    if (confirmationBody !== undefined) {
      throw cliError(
        "THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED",
        confirmationBody,
        {
          suggestedNextAction: workerTargetConfirmationNextAction(result),
        },
      );
    }
    if (jsonOutput) runtime.stdout.write(`${JSON.stringify(result)}\n`);
    else
      runtime.stdout.write(
        `${text}${workerSendSuccessOutput(displayTarget, result)}`,
      );
    return 0;
  } catch (error) {
    // Raft's `message send` action wraps every failure with
    // `markSendFailureDraftSaved` before `renderError` (`main.js@32620184`);
    // no other command does, so no other command claims a draft state.
    renderWorkerCliError(
      runtime.stderr,
      sendCommand
        ? markSendFailureDraftSaved(error, failureDraftSaved)
        : toWorkerCliError(error),
    );
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
  messageAttachment = false,
  profileAvatar = false,
) {
  const options = parseOptions(arguments_.slice(2));
  assertAllowed(
    options,
    profileAvatar
      ? ["path", "mime-type"]
      : [
          "filename",
          "idempotency-key",
          "mime-type",
          "path",
          ...(messageAttachment ? ["target", "context-receipt"] : ["task-id"]),
        ],
  );
  const sourcePath = resolve(boundedText(options, "path", 4_096));
  let handle;
  try {
    handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size >
        (profileAvatar ? PROFILE_IMAGE_MAX_BYTES : MAX_ATTACHMENT_BYTES) ||
      !Number.isSafeInteger(metadata.size)
    ) {
      throw new Error(
        `${profileAvatar ? "avatar" : "artifact"} must be a regular file between 1 and ${String(profileAvatar ? PROFILE_IMAGE_MAX_BYTES : MAX_ATTACHMENT_BYTES)} bytes`,
      );
    }
    if (profileAvatar)
      return ProfileImageUploadResponseSchema.parse(
        await putWorkerUpload(
          context,
          handle,
          "/v1/worker/profile/self/avatar",
          ProfileImageMimeTypeSchema.parse(options["mime-type"]),
        ),
      );
    const uploadSchema = messageAttachment
      ? WorkerMessageAttachmentUploadSchema
      : WorkerArtifactUploadSchema;
    const prepareSchema = messageAttachment
      ? WorkerMessageAttachmentPrepareRequestSchema
      : WorkerArtifactPrepareRequestSchema;
    const resourcePath = messageAttachment
      ? "/v1/worker/attachments"
      : "/v1/worker/artifacts";
    const prepared = uploadSchema.parse(
      await context.send({
        path: `${resourcePath}/prepare`,
        body: prepareSchema.parse({
          filename: options.filename ?? basename(sourcePath),
          // Raft's upload mints its own `clientRequestId`; the model never
          // carries one. RAH lets the server derive it for a message
          // attachment, and `artifact-publish` keeps its explicit key.
          ...(options["idempotency-key"] === undefined && messageAttachment
            ? {}
            : {
                idempotencyKey: boundedText(options, "idempotency-key", 512),
              }),
          mimeType: options["mime-type"] ?? "application/octet-stream",
          size: metadata.size,
          ...(messageAttachment
            ? {
                ...(options.target ? { channel: options.target } : {}),
                ...(options["context-receipt"]
                  ? { contextReceipt: options["context-receipt"] }
                  : {}),
              }
            : { taskId: boundedText(options, "task-id", 512) }),
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

    return uploadSchema.parse(
      await putWorkerUpload(
        context,
        handle,
        `${resourcePath}/${prepared.attachmentId}`,
        "application/octet-stream",
      ),
    );
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

async function putWorkerUpload(
  context: { origin: string; runtime: WorkerCliRuntime; token: string },
  handle: Awaited<ReturnType<typeof open>>,
  path: string,
  mimeType: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Worker artifact upload timed out")),
    ARTIFACT_REQUEST_TIMEOUT_MS,
  );
  try {
    const body = Readable.toWeb(
      handle.createReadStream({ autoClose: false, start: 0 }),
    );
    const response = await context.runtime.fetch(`${context.origin}${path}`, {
      body: body as RequestInit["body"],
      duplex: "half",
      headers: {
        authorization: `Bearer ${context.token}`,
        "content-type": mimeType,
      },
      method: "PUT",
      signal: controller.signal,
    } as RequestInit & { duplex: "half" });
    const result = await readBoundedJson(response.body);
    if (!response.ok) {
      throw workerServerFailureError(result, response.status, "UPLOAD_FAILED");
    }
    return result;
  } finally {
    clearTimeout(timeout);
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
      `${context.origin}/v1/worker/${arguments_[1] === "attachment-download" ? "attachments" : "artifacts"}/${attachmentId}`,
      {
        headers: { authorization: `Bearer ${context.token}` },
        method: "GET",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const result = await readBoundedJson(response.body);
      throw workerServerFailureError(result, response.status, "VIEW_FAILED");
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

function parseCommand(
  arguments_: readonly string[],
  stdinContent = "",
): {
  /** Raft's repeatable `--number` on `task claim`: one command, several Tasks. */
  bodies?: Record<string, unknown>[];
  body: Record<string, unknown>;
  path: string;
} {
  if (arguments_[0] !== "worker" || arguments_[1] === undefined) {
    throw new Error("usage: rah worker <command> [options]");
  }
  const command = arguments_[1];
  const options = parseOptions(
    arguments_.slice(2),
    command === "message-post"
      ? ["anyway", "json", "send-draft", "top-level"]
      : // Raft puts `--json` on 19 of its 80 commands; `version` is the only
        // one of those in the read family (`main.js@32534037`).
        command === "version"
        ? ["json"]
        : command === "message-react"
          ? ["remove"]
          : command === "task-list"
            ? ["mine"]
            : command === "message-read"
              ? ["top-level"]
              : command === "task-amend"
                ? ["clear-description"]
                : command === "task-assign"
                  ? ["unassign"]
                  : [],
    // Raft makes `--number` repeatable on `task claim` and nowhere else.
    command === "task-claim" ? ["number"] : [],
  );
  const readCommand = parseWorkerReadCommand(command, options);
  if (readCommand) return readCommand;
  const channelAttentionCommand = parseWorkerChannelAttentionCommand(
    command,
    options,
  );
  if (channelAttentionCommand) return channelAttentionCommand;
  const managementCommand = parseWorkerTaskManagementCommand(command, options);
  if (managementCommand) return managementCommand;
  const profileCommand = parseWorkerSelfProfileCommand(command, options);
  if (profileCommand) return profileCommand;
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
    case "message-react": {
      // Raft: `react --message-id ID --emoji EMOJI [--remove]`. `--active` is
      // kept as the explicit form of the same toggle; the causal parameters
      // remain accepted pass-throughs and are derived when omitted.
      assertAllowed(options, [
        "message-id",
        "emoji",
        "active",
        "remove",
        "based-on-room-seq",
        "idempotency-key",
      ]);
      if (
        options.active !== undefined &&
        options.active !== "true" &&
        options.active !== "false"
      )
        throw new Error("--active must be true or false");
      if (options.active !== undefined && options.remove !== undefined)
        throw new Error("choose --remove or --active");
      return {
        path: "/v1/worker/messages/react",
        body: WorkerMessageReactionRequestSchema.parse({
          messageId: boundedText(options, "message-id", 512),
          emoji: boundedText(options, "emoji", 64),
          active:
            options.remove === "true" ? false : options.active !== "false",
          ...(options["based-on-room-seq"] === undefined
            ? {}
            : {
                basedOnRoomSeq: nonnegativeInteger(
                  options,
                  "based-on-room-seq",
                ),
              }),
          ...(options["idempotency-key"] === undefined
            ? {}
            : { idempotencyKey: boundedText(options, "idempotency-key", 200) }),
        }),
      };
    }
    case "attachment-cancel":
      assertAllowed(options, ["attachment-id"]);
      return {
        path: "/v1/worker/attachments/cancel",
        body: WorkerMessageAttachmentCancelRequestSchema.parse({
          attachmentId: boundedText(options, "attachment-id", 512),
        }),
      };
    case "message-post":
      assertAllowed(options, [
        "target",
        "context-receipt",
        "anyway",
        "attachment-ids",
        "comment-attachment-id",
        "based-on-room-seq",
        "body",
        "held-draft-id",
        "idempotency-key",
        // `--json` selects the output stream only; it never reaches the server.
        "json",
        "send-draft",
        "thread-id",
        "top-level",
      ]);
      if (
        options["thread-id"] !== undefined &&
        options["top-level"] !== undefined
      )
        throw new Error("--thread-id and --top-level are mutually exclusive");
      // Raft's shape: `--target` alone addresses the send. A receipt, cursor,
      // key or draft id remains accepted but is derived by the server when the
      // model does not present one.
      const targetContext = {
        ...(options.target === undefined
          ? {}
          : { channel: boundedText(options, "target", 500) }),
        ...(options["context-receipt"] === undefined
          ? {}
          : {
              contextReceipt: boundedText(options, "context-receipt", 4096),
            }),
      };
      const causalContext = {
        ...(options["based-on-room-seq"] === undefined
          ? {}
          : {
              basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
            }),
        ...(options["idempotency-key"] === undefined
          ? {}
          : { idempotencyKey: boundedText(options, "idempotency-key", 512) }),
      };
      const replyTarget =
        options["top-level"] === "true"
          ? { threadId: null }
          : options["thread-id"] === undefined
            ? {}
            : { threadId: boundedText(options, "thread-id", 512) };
      if (options["send-draft"] === "true") {
        if (options["comment-attachment-id"] !== undefined)
          throw cliError(
            "SEND_DRAFT_ATTACHMENTS_UNSUPPORTED",
            "--comment-attachment-id cannot replace a held draft’s comment target",
          );
        if (options["attachment-ids"] !== undefined)
          throw cliError(
            "SEND_DRAFT_ATTACHMENTS_UNSUPPORTED",
            "--attachment-ids cannot replace a held draft's attachments",
          );
        if (options.body !== undefined) {
          throw new Error("--body cannot be combined with --send-draft");
        }
        // Raft's `rejectSendDraftStdin`: revised content is a normal send.
        if (stdinContent.trim().length > 0) {
          throw cliError(
            "SEND_DRAFT_STDIN_UNSUPPORTED",
            `--send-draft sends the saved draft unchanged and must not read message content from stdin. To send revised content, send it normally:
  rah worker message-post --target "${options.target ?? "TARGET"}" <<'${MESSAGE_HEREDOC_DELIMITER}'
  message body
  ${MESSAGE_HEREDOC_DELIMITER}`,
          );
        }
        return {
          body: {
            ...replyTarget,
            ...targetContext,
            ...(options.anyway === "true" ? { anyway: true } : {}),
            ...causalContext,
            ...(options["held-draft-id"] === undefined
              ? {}
              : { heldDraftId: boundedText(options, "held-draft-id", 512) }),
            sendDraft: true,
          },
          path: "/v1/worker/messages/post",
        };
      }
      if (options.anyway !== undefined) {
        throw cliError(
          "SEND_DRAFT_ANYWAY_REQUIRES_SEND_DRAFT",
          "--anyway requires --send-draft",
        );
      }
      if (options["held-draft-id"] !== undefined) {
        throw new Error("--held-draft-id requires --send-draft");
      }
      // Precedence: an explicit `--body` wins, otherwise the heredoc on stdin.
      const composedBody =
        options.body === undefined
          ? stdinContent.trim()
          : boundedText(options, "body");
      if (
        composedBody.length === 0 &&
        options["attachment-ids"] === undefined
      ) {
        throw cliError(
          "MISSING_CONTENT",
          `message content is required: pipe the body on stdin, or pass --body TEXT.
  rah worker message-post --target "${options.target ?? "TARGET"}" <<'${MESSAGE_HEREDOC_DELIMITER}'
  message body
  ${MESSAGE_HEREDOC_DELIMITER}`,
        );
      }
      return {
        body: {
          ...replyTarget,
          ...targetContext,
          ...(options["comment-attachment-id"] === undefined
            ? {}
            : {
                commentAttachmentId: boundedText(
                  options,
                  "comment-attachment-id",
                  512,
                ),
              }),
          ...(options["attachment-ids"] === undefined
            ? {}
            : {
                attachmentIds: options["attachment-ids"]
                  .split(",")
                  .map((id) => id.trim()),
              }),
          ...causalContext,
          ...(composedBody.length === 0 ? {} : { body: composedBody }),
        },
        path: "/v1/worker/messages/post",
      };
    case "thread-unfollow": {
      // Raft: `thread unfollow --target '#channel:abcd1234' [--reason TEXT]`.
      assertAllowed(options, [
        "based-on-room-seq",
        "channel",
        "idempotency-key",
        "reason",
        "target",
        "thread-id",
      ]);
      if (options.target !== undefined && options.channel !== undefined)
        throw new Error("choose --target or --channel");
      const channel = options.target ?? options.channel;
      if (channel !== undefined && options["thread-id"] !== undefined)
        throw new Error("choose --target or --thread-id");
      if (channel === undefined && options["thread-id"] === undefined)
        throw new Error(
          "address the Thread with --target \'#channel:threadId\' or with --thread-id",
        );
      return {
        body: {
          ...(options["based-on-room-seq"] === undefined
            ? {}
            : {
                basedOnRoomSeq: nonnegativeInteger(
                  options,
                  "based-on-room-seq",
                ),
              }),
          ...(options["idempotency-key"] === undefined
            ? {}
            : { idempotencyKey: boundedText(options, "idempotency-key", 512) }),
          // Raft defaults the Thread-local notice to this exact wording.
          reason:
            options.reason === undefined
              ? "no longer following"
              : boundedText(options, "reason", 200),
          ...(channel === undefined
            ? { threadId: boundedText(options, "thread-id", 512) }
            : { channel }),
        },
        path: "/v1/worker/threads/unfollow",
      };
    }
    case "task-get":
      return taskQuery(options, "/v1/worker/tasks/get");
    case "task-trajectory": {
      assertAllowed(options, [
        "before-sequence",
        "limit",
        ...TASK_ADDRESS_OPTIONS,
      ]);
      return {
        body: {
          ...taskAddress(options),
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
          ...taskCausality(options),
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
          ...taskCausality(options),
          messageId: boundedText(options, "message-id", 512),
          rationale: boundedText(options, "rationale", 2_000),
        },
        path: "/v1/worker/tasks/claim-message",
      };
    case "task-claim": {
      // Raft: `raft task claim --target "#channel" --number 1 --number 2`.
      assertAllowed(options, [
        "based-on-room-seq",
        "idempotency-key",
        ...TASK_ADDRESS_OPTIONS,
      ]);
      const causality = taskCausality(options);
      const bodies = taskAddressList(options).map((address) => ({
        ...causality,
        ...address,
      }));
      return {
        body: bodies[0]!,
        ...(bodies.length > 1 ? { bodies } : {}),
        path: "/v1/worker/tasks/claim",
      };
    }
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
        ...TASK_ADDRESS_OPTIONS,
      ]);
      const disposition = boundedText(options, "disposition", 64);
      if (disposition !== "approved" && disposition !== "changes_requested") {
        throw new Error("--disposition must be approved or changes_requested");
      }
      return {
        body: {
          ...taskCausality(options),
          ...taskAddress(options),
          disposition,
          summary: boundedText(options, "summary"),
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
        // Raft's `reminder schedule` carries no cursor; the server resolves the
        // anchor against the read position it already owns.
        ...(options["based-on-room-seq"] === undefined
          ? {}
          : {
              basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq"),
            }),
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

/**
 * Raft carries neither `--based-on-room-seq` nor `--idempotency-key` on a Task
 * command; the server resolves both. Both remain accepted pass-throughs.
 */
function taskCausality(
  options: Readonly<Record<string, string>>,
): Record<string, unknown> {
  return {
    ...(options["based-on-room-seq"] === undefined
      ? {}
      : { basedOnRoomSeq: nonnegativeInteger(options, "based-on-room-seq") }),
    ...(options["idempotency-key"] === undefined
      ? {}
      : { idempotencyKey: boundedText(options, "idempotency-key", 512) }),
  };
}

function taskQuery(
  options: Readonly<Record<string, string>>,
  path: string,
): { body: Record<string, unknown>; path: string } {
  assertAllowed(options, [...TASK_ADDRESS_OPTIONS]);
  return { body: taskAddress(options), path };
}

function taskMutation(
  options: Readonly<Record<string, string>>,
  path: string,
  contentField?: "progress" | "question" | "reason" | "summary",
): { body: Record<string, unknown>; path: string } {
  assertAllowed(options, [
    "based-on-room-seq",
    "idempotency-key",
    ...TASK_ADDRESS_OPTIONS,
    ...(contentField === undefined ? [] : [contentField]),
  ]);
  return {
    body: {
      ...taskCausality(options),
      ...taskAddress(options),
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
    ...TASK_ADDRESS_OPTIONS,
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
    body: taskSubmitBody({
      ...taskCausality(options),
      ...taskAddress(options),
      summary: boundedText(options, "summary"),
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

/**
 * The strict submit schema still validates the whole body whenever the Agent
 * addressed the Task by id; a `--target`/`--number` address is resolved by the
 * server before that schema runs, so only the rest is checked here.
 */
function taskSubmitBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (body.taskId === undefined) return body;
  return WorkerTaskSubmitRequestSchema.parse(body) as Record<string, unknown>;
}

function parseOptions(
  arguments_: readonly string[],
  booleanFlags: readonly string[] = [],
  repeatableFlags: readonly string[] = [],
): Record<string, string> {
  const flags = new Set(booleanFlags);
  // Raft's `parse: (value, prev = []) => prev.concat(value)`: only the flags a
  // command declares repeatable may appear more than once.
  const repeatable = new Set(repeatableFlags);
  const options: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index]!;
    if (!option.startsWith("--") || option.length <= 2) {
      throw new Error(`invalid Worker option: ${option}`);
    }
    const name = option.slice(2);
    if (Object.hasOwn(options, name) && !repeatable.has(name)) {
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
    if (value.includes(REPEATED_VALUE_SEPARATOR)) {
      throw new Error(`Worker option --${name} has an unsupported value`);
    }
    options[name] = Object.hasOwn(options, name)
      ? `${options[name]!}${REPEATED_VALUE_SEPARATOR}${value}`
      : value;
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
    throw cliError(
      "MISSING_TOKEN",
      "RAH_WORKER_SESSION_FILE must be an absolute path",
    );
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
      throw cliError(
        "TOKEN_FILE_UNREADABLE",
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
      throw cliError(
        "TOKEN_FILE_UNREADABLE",
        "Worker token file contains an invalid credential",
      );
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
  maxBytes = MAX_RESPONSE_BYTES,
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
      if (total > maxBytes) {
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
    throw cliError(
      "INVALID_JSON_RESPONSE",
      "Worker response is not valid bounded JSON",
    );
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
    throw cliError(
      "MISSING_SERVER_URL",
      "RAH_WORKER_API_URL must be an HTTP(S) origin",
    );
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

function help(): string {
  return `rah app config --app system.cleaner [--set key=value] [--unset key]
rah agent inbox check
rah agent inbox recheck
rah agent inbox ack --item-id ID --version N
App Inbox ack confirms a notification, not successful memory cleanup or a Room/Task action.
rah reminder schedule --title TEXT (--delay-seconds N|--fire-at ISO|--repeat RULE) --message-id ID [--channel #ROOM] [--tz IANA]
rah reminder list [--status scheduled,fired,canceled|--all]
rah reminder cancel --id ID
rah reminder snooze --id ID --by 30m
rah reminder update --id ID (--in 30m|--fire-at ISO|--cadence RULE|--title TEXT) [--tz IANA]
rah reminder log --id ID
rah worker sync [--after-seq N]
rah worker acknowledge --through-seq N
rah worker room-list [--limit N] [--cursor CURSOR]
rah worker room-read --target TARGET [--limit N]
rah worker room-resolve --target ROOM_ID|#CHANNEL|dm:@HANDLE[:THREAD_ID]
rah worker message-read [--target TARGET] [--before ID|--after ID|--around ID] [--thread-id ID|--top-level] [--limit N] [--cursor CURSOR]
rah worker message-resolve --message-id ID [--target TARGET]
rah worker room-members [--target TARGET] [--limit N] [--cursor CURSOR]
rah worker version [--json]
rah worker whoami
rah worker server-info [--target TARGET] [--limit N] [--cursor CURSOR]
rah worker profile-avatar-publish --path FILE --mime-type image/png|image/jpeg|image/gif|image/webp
rah worker profile-self-get
rah worker profile-update [--display-name TEXT] [--description TEXT] [--avatar-key KEY] [--avatar-upload-intent-id ID]
rah worker profile-show [--target ID|@HANDLE] [--channel TARGET] [--created-agents-limit N] [--created-agents-cursor CURSOR]
rah worker task-assign TASK (--assignee AGENT_ID | --unassign)
rah worker channel-mute [--target #CHANNEL]
rah worker channel-unmute [--target #CHANNEL]
rah worker task-delete TASK
rah worker task-amend TASK [--title TEXT] [--description TEXT | --clear-description]
rah worker task-unblock TASK
rah worker task-convert --message-id ID
rah worker task-list [--target TARGET] [--mine] [--status todo|in_progress|in_review|done|closed|all] [--limit N] [--cursor CURSOR]
rah worker task-history --task-id ID [--target TARGET] [--limit N] [--cursor CURSOR]
No command needs a causal cursor or an idempotency key: RAH resolves the read position and the operation identity itself.
Read tools expose current facts in already joined Rooms and DMs without acknowledging Inbox or authorizing newer mutation cursors. Task lists show current projections, not MVCC snapshots.
rah worker message-search [--query TEXT] [--target TARGET] [--sender @HANDLE|ID] [--sender-id ID] [--after ISO_TIMESTAMP] [--before ISO_TIMESTAMP] [--sort relevance|recent] [--limit N] [--cursor CURSOR]
rah worker message-react --message-id ID --emoji EMOJI [--remove]
rah worker message-post --target TARGET <<'${MESSAGE_HEREDOC_DELIMITER}' [--attachment-ids ID,ID] [--thread-id ID | --top-level]
rah worker message-post --send-draft --target TARGET [--anyway]
Message content is read from stdin; use a heredoc so quotes, backticks and newlines stay literal. --send-draft takes no stdin: it sends the saved draft unchanged. Never use --send-draft when changing content.
Commands print human-readable text on stdout: read it. Only message-post and version accept --json, and only when you need the machine-readable object; whoami answers in JSON and takes no flag.
rah worker thread-unfollow --target "#channel:THREAD_ID" [--reason TEXT]
rah worker attachment-publish --path FILE [--target TARGET --context-receipt RECEIPT] [--filename NAME] [--mime-type TYPE]
rah worker attachment-comments --attachment-id ID [--limit N] [--before-room-seq N]
rah worker attachment-capabilities
rah worker attachment-cancel --attachment-id ID
rah worker attachment-download --attachment-id ID --output FILE
rah worker artifact-publish --task-id ID --path FILE [--filename NAME] [--mime-type TYPE] --idempotency-key KEY
rah worker artifact-download --attachment-id ID --output FILE
rah worker task-get TASK
rah worker task-submission TASK
rah worker task-trajectory TASK [--limit N] [--before-sequence N]
Reviewers read the owner's recorded commands and file edits before recording a Review.
rah worker task-input-status TASK
rah worker task-create --title TEXT [--assignee PARTICIPANT_ID]
rah worker task-claim-message --message-id ID --rationale TEXT
rah worker task-claim --target TARGET --number N [--number N ...]
rah worker task-start|task-release TASK
rah worker task-progress TASK --progress TEXT
rah worker task-block TASK --reason TEXT
rah worker task-request-input TASK --question TEXT
rah worker task-submit TASK --summary TEXT [--verification-status passed|failed|not_run --verification-summary TEXT --verification-artifact-ids ID,ID]
rah worker task-review TASK --disposition approved|changes_requested --summary TEXT
TASK addresses one Task as --target "#channel" --number N, or as --task-id ID.
`;
}

async function parseWorkerRequest<T>(parse: () => Promise<T>): Promise<T> {
  try {
    return await parse();
  } catch (error) {
    if (error instanceof WorkerCliError) throw error;
    throw cliError(
      "INVALID_ARG",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
