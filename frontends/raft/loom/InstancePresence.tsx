import { Status } from "raft-ui";
import type { AgentPresence } from "@rah-os/protocol";
import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
export function useInstancePresence(
  client: RahClient,
  controlRoomId: string | undefined,
  active = true,
) {
  const [states, setStates] = useState<AgentPresence[]>([]);
  useEffect(() => {
    setStates([]);
    if (!active || !controlRoomId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = await client.request(
          "agent.presence.list",
          { controlRoomId },
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) setStates(result.agents);
      } catch {
        if (!abort.signal.aborted) setStates([]);
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 10000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, controlRoomId, active]);
  return states;
}
export default function InstancePresence({
  activity,
  label,
}: {
  activity?: AgentPresence["activity"];
  label?: string;
}) {
  const text =
    label ??
    (activity
      ? {
          online: "在线",
          offline: "离线",
          working: "工作中",
          thinking: "思考中",
          error: "异常",
        }[activity]
      : "状态未知");
  const presence =
    activity === "working" || activity === "thinking"
      ? "busy"
      : (activity ?? "offline");
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-footnote text-foreground-hint"
      title={text}
    >
      <Status presence={presence} aria-label={text} />
      <span>{text}</span>
    </span>
  );
}
