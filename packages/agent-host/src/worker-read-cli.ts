import * as P from "@rah-os/protocol";

type Command = { body: Record<string, unknown>; path: string };
export function parseWorkerReadCommand(
  command: string,
  options: Record<string, string>,
): Command | undefined {
  const allowed = (keys: readonly string[]) => {
    for (const key of Object.keys(options))
      if (!keys.includes(key))
        throw new Error(`unknown --${key} option for ${command}`);
  };
  if (command === "version" || command === "whoami") {
    allowed([]);
    return {
      path:
        command === "version" ? "/v1/worker/version" : "/v1/worker/auth/whoami",
      body: P.WorkerIntrospectionRequestSchema.parse({}),
    };
  }
  const page = () => ({
    ...(options.limit === undefined ? {} : { limit: Number(options.limit) }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  });
  if (command === "attachment-comments") {
    allowed(["attachment-id", "limit", "before-room-seq"]);
    return {
      path: "/v1/worker/attachments/comments",
      body: P.AttachmentCommentsRequestSchema.parse({
        attachmentId: options["attachment-id"],
        ...(options.limit === undefined
          ? {}
          : { limit: Number(options.limit) }),
        ...(options["before-room-seq"] === undefined
          ? {}
          : { beforeRoomSeq: Number(options["before-room-seq"]) }),
      }),
    };
  }
  const target = () => {
    if (options.target !== undefined && options.channel !== undefined)
      throw new Error("choose --target or --channel");
    const channel = options.target ?? options.channel;
    return channel === undefined ? {} : { channel };
  };
  if (command === "room-read") {
    allowed(["target", "channel", "limit", "context-receipt"]);
    return {
      path: "/v1/worker/rooms/read",
      body: P.WorkerRoomContextRequestSchema.parse({
        ...target(),
        ...(options.limit === undefined
          ? {}
          : { limit: Number(options.limit) }),
        ...(options["context-receipt"] === undefined
          ? {}
          : { contextReceipt: options["context-receipt"] }),
      }),
    };
  }
  if (command === "room-list") {
    allowed(["cursor", "limit"]);
    return {
      path: "/v1/worker/rooms/list",
      body: P.WorkerRoomListRequestSchema.parse(page()),
    };
  }
  if (command === "room-resolve") {
    allowed(["target", "channel"]);
    return {
      path: "/v1/worker/rooms/resolve",
      body: P.WorkerRoomResolveRequestSchema.parse(target()),
    };
  }
  if (command === "attachment-capabilities") {
    allowed([]);
    return {
      path: "/v1/worker/attachments/capabilities",
      body: P.WorkerAttachmentUploadCapabilitiesRequestSchema.parse({}),
    };
  }
  if (command === "message-search") {
    allowed([
      "query",
      "cursor",
      "limit",
      "target",
      "channel",
      "sender",
      "sender-id",
      "after",
      "before",
      "sort",
    ]);
    return {
      path: "/v1/worker/messages/search",
      body: P.WorkerMessageSearchRequestSchema.parse({
        ...page(),
        ...target(),
        ...(options.query === undefined ? {} : { query: options.query }),
        ...(options.sender === undefined ? {} : { sender: options.sender }),
        ...(options["sender-id"] === undefined
          ? {}
          : { senderId: options["sender-id"] }),
        ...(options.after === undefined ? {} : { after: options.after }),
        ...(options.before === undefined ? {} : { before: options.before }),
        ...(options.sort === undefined ? {} : { sort: options.sort }),
      }),
    };
  }
  if (command === "message-read") {
    allowed([
      "target",
      "channel",
      "before",
      "after",
      "around",
      "cursor",
      "limit",
      "thread-id",
      "top-level",
    ]);
    if (
      options["thread-id"] !== undefined &&
      options["top-level"] !== undefined
    )
      throw new Error("choose --thread-id or --top-level");
    return {
      path: "/v1/worker/messages/history",
      body: P.WorkerHistoryRequestSchema.parse({
        ...page(),
        ...target(),
        ...(options.before === undefined ? {} : { before: options.before }),
        ...(options.after === undefined ? {} : { after: options.after }),
        ...(options.around === undefined ? {} : { around: options.around }),
        ...(options["thread-id"] === undefined
          ? {}
          : { threadId: options["thread-id"] }),
        ...(options["top-level"] === undefined ? {} : { threadId: null }),
      }),
    };
  }
  if (command === "message-resolve") {
    allowed(["message-id", "target", "channel"]);
    return {
      path: "/v1/worker/messages/resolve",
      body: P.WorkerMessageResolveRequestSchema.parse({
        messageId: options["message-id"],
        ...target(),
      }),
    };
  }
  if (command === "room-members" || command === "server-info") {
    allowed(["cursor", "limit", "target", "channel"]);
    return {
      path:
        command === "room-members"
          ? "/v1/worker/room/members"
          : "/v1/worker/server/info",
      body: P.WorkerMembersRequestSchema.parse({ ...page(), ...target() }),
    };
  }
  if (command === "profile-show") {
    allowed([
      "target",
      "channel",
      "created-agents-limit",
      "created-agents-cursor",
    ]);
    return {
      path: "/v1/worker/profiles/get",
      body: P.WorkerProfileReadRequestSchema.parse({
        ...(options["created-agents-limit"] === undefined
          ? {}
          : { createdAgentsLimit: Number(options["created-agents-limit"]) }),
        ...(options["created-agents-cursor"] === undefined
          ? {}
          : { createdAgentsCursor: options["created-agents-cursor"] }),
        ...(options.target === undefined ? {} : { target: options.target }),
        ...(options.channel === undefined ? {} : { channel: options.channel }),
      }),
    };
  }
  if (command === "task-list") {
    allowed(["cursor", "limit", "mine", "status", "target", "channel"]);
    return {
      path: "/v1/worker/tasks/list",
      body: P.WorkerTaskListRequestSchema.parse({
        ...page(),
        ...target(),
        mine: options.mine === "true",
        ...(options.status === undefined || options.status === "all"
          ? {}
          : { status: options.status }),
      }),
    };
  }
  if (command === "task-history") {
    allowed(["cursor", "limit", "task-id", "target", "channel"]);
    return {
      path: "/v1/worker/tasks/history",
      body: P.WorkerTaskHistoryRequestSchema.parse({
        ...page(),
        ...target(),
        taskId: options["task-id"],
      }),
    };
  }
  return undefined;
}
