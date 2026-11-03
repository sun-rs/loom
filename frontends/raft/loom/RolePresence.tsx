import { Status } from "raft-ui";
import { rolePresence } from "./role-presence.ts";
export default function RolePresence({
  state,
}: {
  state: ReturnType<typeof rolePresence>;
}) {
  const label = {
    online: "有在线实例",
    offline: "无在线实例",
    error: "实例异常",
    unknown: "实例状态未知",
  }[state];
  return (
    <Status
      presence={state === "unknown" ? "offline" : state}
      title={label}
      aria-label={label}
      data-testid="role-presence"
      data-state={state}
      className="size-[9px]"
    />
  );
}
