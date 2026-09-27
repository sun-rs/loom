import { Readable } from "node:stream";

import { cliError, renderWorkerCliError } from "./worker-cli-error.ts";
import { runWorkerCliCommand, type WorkerCliRuntime } from "./worker-cli.ts";
import {
  RAH_WORKER_TURN_ROOT_ENV,
  readCurrentWorkerTurn,
} from "./worker-turn-handle.ts";

/**
 * Loom Worker tool facade (evo §57; owner decision 2026-09-27, review
 * `2026-09-27-worker-tool-facade.md`). Two structured tools, `message_post`
 * and `message_check`, map onto the existing Worker CLI in-process: the
 * arguments become the CLI argv, the body is injected as the CLI's stdin
 * (the heredoc path, so the same trim and the same server-derived
 * idempotency digest), and the result is the CLI's own stdout/stderr text
 * with `isError = exit !== 0`. This module owns only the schema, the
 * argument mapping and the result mapping — no route, queue, cursor, retry
 * or business decision: turn credentials, ACK-on-post, the reply-target
 * guard, held drafts and idempotency stay in the CLI and the Worker service.
 *
 * Deliberate deviation from Raft 1.0.32, which posts through its CLI over a
 * shell (`raft message send`); approved by the owner for the first-round
 * drafting cost measured in the efficiency gate. Every other Worker command
 * stays CLI-only.
 *
 * The turn handle is never a model parameter: a warm runtime's facade reads
 * the active turn published under the turn root (`readCurrentWorkerTurn`);
 * a per-Activation runtime has no root and uses its environment credential.
 */
export type WorkerToolDefinition = Readonly<{
  name: "message_post" | "message_check";
  description: string;
  inputSchema: Readonly<{
    type: "object";
    properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    required?: readonly string[];
    additionalProperties: false;
  }>;
}>;

export const WORKER_TOOL_DEFINITIONS: readonly WorkerToolDefinition[] =
  Object.freeze([
    {
      name: "message_post",
      description:
        "Post one Room message as yourself (Worker CLI message-post). Returns the CLI output; trust its Effect line.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "Exact target of the received message: #room-slug, dm:@handle or #room-slug:THREAD_ID",
          },
          body: { type: "string", description: "Message text" },
          based_on_room_seq: {
            type: "integer",
            minimum: 0,
            description: "The Reply line's seq",
          },
          final: {
            type: "boolean",
            description: "true on the post completing your reply",
          },
        },
        required: ["target", "body"],
        additionalProperties: false,
      },
    },
    {
      name: "message_check",
      description:
        "Deliver your pending Room messages (Worker CLI message-check).",
      inputSchema: {
        type: "object",
        properties: {
          replay: {
            type: "boolean",
            description: "true after a lost tool result",
          },
        },
        additionalProperties: false,
      },
    },
  ]);

export type WorkerToolResult = { text: string; isError: boolean };

export type WorkerToolRuntime = Readonly<{
  env: WorkerCliRuntime["env"];
  fetch: WorkerCliRuntime["fetch"];
}>;

type Invocation =
  | { argv: string[]; stdin?: string }
  | { error: { code: string; message: string } };

function invocation(name: string, args: unknown): Invocation {
  const invalid = (message: string): Invocation => ({
    error: { code: "INVALID_ARG", message },
  });
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return invalid("tool arguments must be an object");
  const input = args as Record<string, unknown>;
  const known = WORKER_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (known === undefined) return invalid(`unknown Worker tool '${name}'`);
  for (const key of Object.keys(input))
    if (!Object.hasOwn(known.inputSchema.properties, key))
      return invalid(`${name} has no argument '${key}'`);
  if (name === "message_check") {
    if (input.replay !== undefined && typeof input.replay !== "boolean")
      return invalid("replay must be a boolean");
    return {
      argv: ["worker", "message-check", ...(input.replay ? ["--replay"] : [])],
    };
  }
  if (typeof input.target !== "string")
    return invalid("target must be a string");
  if (typeof input.body !== "string") return invalid("body must be a string");
  if (input.final !== undefined && typeof input.final !== "boolean")
    return invalid("final must be a boolean");
  const seq = input.based_on_room_seq;
  if (seq !== undefined && typeof seq !== "number")
    return invalid("based_on_room_seq must be an integer");
  return {
    argv: [
      "worker",
      "message-post",
      "--target",
      input.target,
      ...(seq === undefined ? [] : ["--based-on-room-seq", String(seq)]),
      ...(input.final === true ? ["--final"] : []),
    ],
    stdin: input.body,
  };
}

/** One tool call: the Worker CLI with this argv and stdin, output verbatim. */
export async function invokeWorkerTool(
  name: string,
  args: unknown,
  runtime: WorkerToolRuntime,
): Promise<WorkerToolResult> {
  let text = "";
  const output = { write: (value: string) => (text += value) };
  const refuse = (code: string, message: string): WorkerToolResult => {
    renderWorkerCliError(
      output,
      cliError(
        code,
        message,
        name === "message_post"
          ? { draftSaved: false, effect: "not_sent" }
          : {},
      ),
    );
    return { text, isError: true };
  };
  const call = invocation(name, args);
  if ("error" in call) return refuse(call.error.code, call.error.message);
  const argv = [...call.argv];
  const root = runtime.env[RAH_WORKER_TURN_ROOT_ENV];
  if (root !== undefined && root !== "") {
    const handle = await readCurrentWorkerTurn(root);
    if (handle === undefined)
      return refuse(
        "TURN_HANDLE_INACTIVE",
        "No Loom turn is active for this tool call; nothing was sent.",
      );
    argv.push("--turn", handle);
  }
  const exit = await runWorkerCliCommand(argv, {
    env: runtime.env,
    fetch: runtime.fetch,
    stderr: output,
    stdout: output,
    ...(call.stdin === undefined
      ? {}
      : {
          stdin: Readable.from(
            call.stdin === "" ? [] : [Buffer.from(call.stdin, "utf8")],
          ),
        }),
  });
  return { text, isError: exit !== 0 };
}
