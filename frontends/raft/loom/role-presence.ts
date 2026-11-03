import type { AgentPresence } from "@rah-os/protocol";
export function rolePresence(
  ids: readonly string[],
  activities: readonly Pick<AgentPresence, "agentId" | "activity">[],
) {
  const states = ids.map(
    (id) => activities.find((a) => a.agentId === id)?.activity,
  );
  if (
    states.some(
      (state) =>
        state === "online" || state === "working" || state === "thinking",
    )
  )
    return "online";
  if (states.includes("error")) return "error";
  return states.some((state) => !state) ? "unknown" : "offline";
}
export function computerInstances<
  T extends { instanceId: string; agentId: string; roleId: string },
>(
  runtimes: readonly {
    agentBindings: readonly {
      agentId: string;
      participantId: string;
      handle: string;
    }[];
  }[],
  instances: readonly T[],
) {
  const bindings = new Map(
    runtimes.flatMap((r) => r.agentBindings).map((b) => [b.participantId, b]),
  );
  return instances.flatMap((i) => {
    const b = bindings.get(i.instanceId);
    return b?.agentId === i.agentId ? [{ ...i, name: b.handle }] : [];
  });
}
