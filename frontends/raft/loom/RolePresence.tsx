import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { RoomAgentActivity } from "@rah-os/protocol";
import { rolePresence } from "./role-presence.ts";
export function useRolePresence(
  client: RahClient,
  instances: readonly { instanceId: string; channelId: string }[],
  active: boolean,
) {
  const key = JSON.stringify(instances.map((i) => [i.instanceId, i.channelId]));
  const [states, setStates] = useState<RoomAgentActivity[]>([]);
  useEffect(() => {
    setStates([]);
    if (!active) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const results = await Promise.allSettled(
        [...new Set(instances.map((i) => i.channelId))].map((roomId) =>
          client.request(
            "room.agent.activity.list",
            { roomId },
            { signal: abort.signal },
          ),
        ),
      );
      if (abort.signal.aborted) return;
      setStates(
        results.flatMap((r) =>
          r.status === "fulfilled" ? r.value.agents : [],
        ),
      );
      timer = setTimeout(read, 10000);
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, key, active]);
  return states;
}
export default function RolePresence({
  state,
}: {
  state: ReturnType<typeof rolePresence>;
}) {
  const label = {
    working: "有实例运行中",
    waking: "有实例排队或启动中",
    error: "有实例错误",
    idle: "无实例正在运行",
    unknown: "实例状态未知",
  }[state];
  return (
    <span
      title={label}
      aria-label={label}
      data-testid="role-presence"
      data-state={state}
      className={`block size-[9px] rounded-[2px] border-[1.5px] border-sticker-ink ${state === "working" ? "bg-presence-online" : state === "waking" ? "bg-presence-busy" : state === "error" ? "bg-danger" : "bg-presence-offline"}`}
    />
  );
}
