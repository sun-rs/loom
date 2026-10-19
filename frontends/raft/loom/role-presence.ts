import type { RoomAgentActivity } from "@rah-os/protocol";
export function rolePresence(
  ids: readonly string[],
  activities: readonly Pick<RoomAgentActivity, "participantId" | "state">[],
) {
  const states = ids.map(
    (id) => activities.find((a) => a.participantId === id)?.state,
  );
  for (const state of ["working", "error", "waking"] as const)
    if (states.includes(state)) return state;
  return states.some((state) => !state) ? "unknown" : "idle";
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
