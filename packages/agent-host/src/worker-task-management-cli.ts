import {
  TaskAmendRequestSchema,
  TaskDeleteRequestSchema,
} from "@rah-os/protocol";
import {
  WorkerTaskAssignRequestSchema,
  WorkerTaskUnblockRequestSchema,
  WorkerTaskConvertRequestSchema,
} from "@rah-os/protocol";
export function parseWorkerTaskManagementCommand(
  command: string,
  options: Record<string, string>,
): { path: string; body: Record<string, unknown> } | undefined {
  if (command === "task-delete") {
    for (const key of Object.keys(options))
      if (
        ![
          "room-id",
          "task-id",
          "based-on-room-seq",
          "idempotency-key",
        ].includes(key)
      )
        throw new Error(`unknown --${key} option for ${command}`);
    return {
      path: "/v1/worker/tasks/delete",
      body: TaskDeleteRequestSchema.parse({
        roomId: options["room-id"],
        taskId: options["task-id"],
        basedOnRoomSeq: Number(options["based-on-room-seq"]),
        idempotencyKey: options["idempotency-key"],
      }),
    };
  }
  if (command === "task-amend") {
    for (const key of Object.keys(options))
      if (
        ![
          "task-id",
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
    return {
      path: "/v1/worker/tasks/amend",
      body: TaskAmendRequestSchema.parse({
        taskId: options["task-id"],
        basedOnRoomSeq: Number(options["based-on-room-seq"]),
        idempotencyKey: options["idempotency-key"],
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(options["clear-description"] !== undefined
          ? { description: null }
          : options.description !== undefined
            ? { description: options.description }
            : {}),
      }),
    };
  }
  if (!["task-assign", "task-convert", "task-unblock"].includes(command))
    return undefined;
  const allowed =
    command === "task-assign"
      ? [
          "task-id",
          "assignee",
          "unassign",
          "based-on-room-seq",
          "idempotency-key",
        ]
      : [
          command === "task-unblock" ? "task-id" : "message-id",
          "based-on-room-seq",
          "idempotency-key",
        ];
  for (const key of Object.keys(options))
    if (!allowed.includes(key))
      throw new Error(`unknown --${key} option for ${command}`);
  const common = {
    basedOnRoomSeq: Number(options["based-on-room-seq"]),
    idempotencyKey: options["idempotency-key"],
  };
  if (command === "task-unblock")
    return {
      path: "/v1/worker/tasks/unblock",
      body: WorkerTaskUnblockRequestSchema.parse({
        ...common,
        taskId: options["task-id"],
      }),
    };
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
  return {
    path: "/v1/worker/tasks/assign",
    body: WorkerTaskAssignRequestSchema.parse({
      ...common,
      taskId: options["task-id"],
      assigneeId: options.unassign === undefined ? options.assignee : null,
    }),
  };
}
