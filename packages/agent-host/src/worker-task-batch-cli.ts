import {
  WorkerTaskBatchCreateRequestSchema,
  WorkerTaskBatchClaimRequestSchema,
} from "@rah-os/protocol";
import { REPEATED_VALUE_SEPARATOR } from "./worker-task-address-cli.ts";

export function parseWorkerTaskBatchCommand(
  command: string,
  options: Readonly<Record<string, string>>,
  causality: Record<string, unknown>,
): { path: string; body: Record<string, unknown> } | undefined {
  if (command !== "task-create" && command !== "task-claim") return undefined;
  const titles = options.title?.split(REPEATED_VALUE_SEPARATOR);
  const numbers = options.number?.split(REPEATED_VALUE_SEPARATOR);
  const messages = options["message-id"]?.split(REPEATED_VALUE_SEPARATOR);
  if (
    command === "task-create" &&
    (titles?.length ?? 0) <= 1 &&
    options.target === undefined &&
    options.channel === undefined &&
    !options.assignee?.trim().startsWith("@")
  )
    return undefined;
  if (
    command === "task-claim" &&
    (numbers?.length ?? 0) <= 1 &&
    messages === undefined
  )
    return undefined;
  if (options.target !== undefined && options.channel !== undefined)
    throw new Error("choose --target or --channel");
  const channel = options.target ?? options.channel;
  const allowed =
    command === "task-create"
      ? [
          "title",
          "assignee",
          "target",
          "channel",
          "based-on-room-seq",
          "idempotency-key",
        ]
      : [
          "number",
          "message-id",
          "target",
          "channel",
          "based-on-room-seq",
          "idempotency-key",
        ];
  for (const key of Object.keys(options))
    if (!allowed.includes(key))
      throw new Error(`unsupported Worker option: --${key}`);
  if (command === "task-create")
    return {
      path: "/v1/worker/tasks/create-batch",
      body: WorkerTaskBatchCreateRequestSchema.parse({
        ...causality,
        titles,
        ...(channel === undefined ? {} : { channel }),
        ...(options.assignee === undefined
          ? {}
          : { assignee: options.assignee }),
      }),
    };
  if (channel === undefined) throw new Error("batch claim requires --target");
  return {
    path: "/v1/worker/tasks/claim-batch",
    body: WorkerTaskBatchClaimRequestSchema.parse({
      ...causality,
      channel,
      ...(numbers === undefined
        ? {}
        : {
            taskNumbers: numbers.map((raw) => {
              if (
                !/^[1-9][0-9]*$/.test(raw) ||
                !Number.isSafeInteger(Number(raw))
              )
                throw new Error("--number must be a positive integer");
              return Number(raw);
            }),
          }),
      ...(messages === undefined ? {} : { messageIds: messages }),
    }),
  };
}
