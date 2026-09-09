import {
  WorkerTaskAmendRequestSchema,
  WorkerTaskDeleteRequestSchema,
} from "@rah-os/protocol";
import {
  TASK_ADDRESS_OPTIONS,
  taskAddress,
} from "./worker-task-address-cli.ts";
import {
  WorkerTaskAssignRequestSchema,
  WorkerTaskUnblockRequestSchema,
  WorkerTaskConvertRequestSchema,
} from "@rah-os/protocol";

/** Raft carries neither causal parameter; both stay accepted pass-throughs. */
function causality(options: Record<string, string>): Record<string, unknown> {
  return {
    ...(options["based-on-room-seq"] === undefined
      ? {}
      : { basedOnRoomSeq: Number(options["based-on-room-seq"]) }),
    ...(options["idempotency-key"] === undefined
      ? {}
      : { idempotencyKey: options["idempotency-key"] }),
  };
}
export function parseWorkerTaskManagementCommand(
  command: string,
  options: Record<string, string>,
): { path: string; body: Record<string, unknown> } | undefined {
  if (command === "task-delete") {
    for (const key of Object.keys(options))
      if (
        ![
          "room-id",
          ...TASK_ADDRESS_OPTIONS,
          "based-on-room-seq",
          "idempotency-key",
        ].includes(key)
      )
        throw new Error(`unknown --${key} option for ${command}`);
    const address = taskAddress(options);
    const body = {
      ...(options["room-id"] === undefined
        ? {}
        : { roomId: options["room-id"] }),
      ...address,
      ...causality(options),
    };
    // Raft's `task delete` names no Room at all: a `--target`/`--number`
    // address already resolves one, and a `--task-id` is deleted in the Room
    // this Activation is bound to. `--room-id` stays an accepted explicit form.
    return {
      path: "/v1/worker/tasks/delete",
      body:
        address.taskId === undefined
          ? body
          : (WorkerTaskDeleteRequestSchema.parse(body) as Record<
              string,
              unknown
            >),
    };
  }
  if (command === "task-amend") {
    for (const key of Object.keys(options))
      if (
        ![
          ...TASK_ADDRESS_OPTIONS,
          "title",
          "description",
          "clear-description",
          "based-on-room-seq",
          "idempotency-key",
        ].includes(key)
      )
        throw new Error(`unknown --${key} option for ${command}`);
    if (
      options.description !== undefined &&
      options["clear-description"] !== undefined
    )
      throw new Error("choose --description or --clear-description");
    const address = taskAddress(options);
    const body = {
      ...address,
      ...causality(options),
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options["clear-description"] !== undefined
        ? { description: null }
        : options.description !== undefined
          ? { description: options.description }
          : {}),
    };
    return {
      path: "/v1/worker/tasks/amend",
      body:
        address.taskId === undefined
          ? body
          : (WorkerTaskAmendRequestSchema.parse(body) as Record<
              string,
              unknown
            >),
    };
  }
  if (!["task-assign", "task-convert", "task-unblock"].includes(command))
    return undefined;
  const allowed =
    command === "task-assign"
      ? [
          ...TASK_ADDRESS_OPTIONS,
          "assignee",
          "unassign",
          "based-on-room-seq",
          "idempotency-key",
        ]
      : command === "task-unblock"
        ? [...TASK_ADDRESS_OPTIONS, "based-on-room-seq", "idempotency-key"]
        : ["message-id", "based-on-room-seq", "idempotency-key"];
  for (const key of Object.keys(options))
    if (!allowed.includes(key))
      throw new Error(`unknown --${key} option for ${command}`);
  const common = causality(options);
  if (command === "task-unblock") {
    const address = taskAddress(options);
    const body = { ...common, ...address };
    return {
      path: "/v1/worker/tasks/unblock",
      body:
        address.taskId === undefined
          ? body
          : (WorkerTaskUnblockRequestSchema.parse(body) as Record<
              string,
              unknown
            >),
    };
  }
  if (command === "task-convert")
    return {
      path: "/v1/worker/tasks/convert",
      body: WorkerTaskConvertRequestSchema.parse({
        ...common,
        messageId: options["message-id"],
      }),
    };
  if (
    Number(options.assignee !== undefined) +
      Number(options.unassign !== undefined) !==
    1
  )
    throw new Error("choose --assignee or --unassign");
  const address = taskAddress(options);
  const assigned = {
    ...common,
    ...address,
    assigneeId: options.unassign === undefined ? options.assignee : null,
  };
  return {
    path: "/v1/worker/tasks/assign",
    body:
      address.taskId === undefined
        ? assigned
        : (WorkerTaskAssignRequestSchema.parse(assigned) as Record<
            string,
            unknown
          >),
  };
}
