import type { NavigationTarget } from "@rah-os/protocol";
/** Called only after navigation.resolve has verified membership and enriched roots. */
export function pushTargetParams(target: NavigationTarget): URLSearchParams {
  switch (target.kind) {
    case "room":
      return new URLSearchParams({ room: target.roomId });
    case "message":
    case "thread": {
      if (target.threadId && !target.rootMessageId)
        throw Error("通知的消息列位置无法核实。");
      const params = new URLSearchParams({ room: target.roomId });
      if (target.kind === "message") params.set("message", target.messageId);
      if (target.rootMessageId) params.set("thread", target.rootMessageId);
      return params;
    }
    case "task":
      return new URLSearchParams({
        view: "tasks",
        taskChannel: target.roomId,
        task: target.taskId,
      });
    case "input_request":
      return target.taskId
        ? new URLSearchParams({
            view: "tasks",
            taskChannel: target.roomId,
            task: target.taskId,
          })
        : new URLSearchParams({ room: target.roomId });
    case "computer":
      return new URLSearchParams({
        view: "computers",
        computer: target.hostId,
      });
    default:
      throw Error("此类通知尚没有可用的页面入口。");
  }
}
