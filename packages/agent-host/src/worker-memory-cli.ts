import { randomUUID } from "node:crypto";

import {
  WorkerMemoryHistoryRequestSchema,
  WorkerMemoryInvalidateRequestSchema,
  WorkerMemoryListRequestSchema,
  WorkerMemoryReadRequestSchema,
  WorkerMemoryRestoreRequestSchema,
  WorkerMemorySearchRequestSchema,
  WorkerMemoryUpdateRequestSchema,
  WorkerMemoryWriteRequestSchema,
} from "@rah-os/protocol";

/**
 * evo S6 batch A: `loom-worker memory <action>`. The command carries only the
 * entry fields; the channel, author, Role, model, session and RunAttempt are
 * derived by the Kernel from the Worker credential, so no option for them
 * exists. There is no delete: deleting memory is Human-only.
 */
const ACTIONS = {
  history: { flags: [], values: ["name"] },
  invalidate: {
    flags: [],
    values: ["name", "expected-revision", "reason", "idempotency-key"],
  },
  list: { flags: ["include-invalidated"], values: ["limit"] },
  read: { flags: [], values: ["name"] },
  restore: {
    flags: [],
    values: ["name", "expected-revision", "idempotency-key"],
  },
  search: { flags: [], values: ["query", "limit"] },
  update: {
    flags: ["body-stdin"],
    values: [
      "name",
      "expected-revision",
      "type",
      "description",
      "body",
      "idempotency-key",
    ],
  },
  write: {
    flags: [],
    values: ["name", "type", "description", "body", "idempotency-key"],
  },
} as const;

type Action = keyof typeof ACTIONS;

export async function parseWorkerMemoryCommand(
  arguments_: readonly string[],
  readStdinBody: () => Promise<string>,
): Promise<{ body: Record<string, unknown>; path: string }> {
  const action = arguments_[2];
  if (action === undefined || !Object.hasOwn(ACTIONS, action))
    throw new Error(
      `usage: loom-worker memory <${Object.keys(ACTIONS).join("|")}> [options]`,
    );
  const spec = ACTIONS[action as Action];
  const options = parseMemoryOptions(
    arguments_.slice(3),
    spec.flags,
    spec.values,
  );
  const key = () => options["idempotency-key"] ?? `memory-${randomUUID()}`;
  const revision = () => positive(options, "expected-revision");
  const path = `/v1/worker/memory/${action}`;
  switch (action as Action) {
    case "write":
      return {
        path,
        body: WorkerMemoryWriteRequestSchema.parse({
          name: options.name,
          type: options.type,
          description: options.description,
          body: options.body ?? (await readStdinBody()),
          idempotencyKey: key(),
        }),
      };
    case "update": {
      if (options.body !== undefined && options["body-stdin"] === "true")
        throw new Error("pass either --body or --body-stdin, not both");
      const body =
        options.body ??
        (options["body-stdin"] === "true" ? await readStdinBody() : undefined);
      return {
        path,
        body: WorkerMemoryUpdateRequestSchema.parse({
          name: options.name,
          expectedRevision: revision(),
          ...(options.type === undefined ? {} : { type: options.type }),
          ...(options.description === undefined
            ? {}
            : { description: options.description }),
          ...(body === undefined ? {} : { body }),
          idempotencyKey: key(),
        }),
      };
    }
    case "invalidate":
      return {
        path,
        body: WorkerMemoryInvalidateRequestSchema.parse({
          name: options.name,
          expectedRevision: revision(),
          reason: options.reason,
          idempotencyKey: key(),
        }),
      };
    case "restore":
      return {
        path,
        body: WorkerMemoryRestoreRequestSchema.parse({
          name: options.name,
          expectedRevision: revision(),
          idempotencyKey: key(),
        }),
      };
    case "list":
      return {
        path,
        body: WorkerMemoryListRequestSchema.parse({
          ...(options["include-invalidated"] === "true"
            ? { includeInvalidated: true }
            : {}),
          ...(options.limit === undefined
            ? {}
            : { limit: positive(options, "limit") }),
        }),
      };
    case "read":
      return {
        path,
        body: WorkerMemoryReadRequestSchema.parse({ name: options.name }),
      };
    case "history":
      return {
        path,
        body: WorkerMemoryHistoryRequestSchema.parse({ name: options.name }),
      };
    case "search":
      return {
        path,
        body: WorkerMemorySearchRequestSchema.parse({
          query: options.query,
          ...(options.limit === undefined
            ? {}
            : { limit: positive(options, "limit") }),
        }),
      };
  }
}

function parseMemoryOptions(
  arguments_: readonly string[],
  flags: readonly string[],
  values: readonly string[],
): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index]!;
    const name = option.startsWith("--") ? option.slice(2) : "";
    if (!flags.includes(name) && !values.includes(name))
      throw new Error(`unknown option: ${option}`);
    if (Object.hasOwn(options, name))
      throw new Error(`duplicate Worker option: --${name}`);
    if (flags.includes(name)) {
      options[name] = "true";
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Worker option --${name} requires one value`);
    options[name] = value;
    index += 1;
  }
  return options;
}

function positive(options: Record<string, string>, name: string): number {
  const source = options[name];
  if (source === undefined || !/^[1-9][0-9]{0,15}$/u.test(source))
    throw new Error(`--${name} must be a positive integer`);
  return Number(source);
}
