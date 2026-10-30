import type { NativeCommands } from "./commands.ts";
// Confirmed UI action steps only. Kernel owns Rooms/membership and HumanSidebar
// owns classification. A partial known refusal stays visible as an ordinary Room;
// it is never guessed back into a DM by name after a document reload.
const pending = new WeakMap<
  NativeCommands,
  Map<string, { roomId?: string; instantiated?: boolean }>
>();
export async function openRoleConversation(c: NativeCommands, input: any) {
  const { bridge } = c,
    { workspace } = await bridge.identity(),
    catalog = await bridge.catalog();
  const role = catalog.roles.find((r: any) => r.roleId === input.agentId);
  if (!role || input.userId)
    throw Error(
      "独立单聊请选择有效 Role；频道实例的私密消息须从所属频道打开。",
    );
  let steps = pending.get(c);
  if (!steps) {
    steps = new Map();
    pending.set(c, steps);
  }
  let progress = steps.get(role.roleId);
  if (!progress) {
    const [{ preferences }, rooms] = await Promise.all([
      bridge.client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      }),
      bridge.rooms(),
    ]);
    const room = preferences.dmOrder
      .map((key) =>
        key.startsWith("room:")
          ? rooms.find((r) => r.roomId === key.slice(5))
          : undefined,
      )
      .find((r) => {
        if (!r || r.kind !== "channel" || r.side || r.archivedAt) return false;
        const members = catalog.instances.filter(
          (i: any) => i.channelId === r.roomId,
        );
        return members.length === 1 && members[0].roleId === role.roleId;
      });
    progress = room ? { roomId: room.roomId, instantiated: true } : {};
    steps.set(role.roleId, progress);
  }
  if (!progress.roomId) {
    const result = await c.mutate(
      "channel-create",
      workspace.controlRoomId,
      {
        workspaceId: workspace.workspaceId,
        name: role.configuration.displayName,
        kind: "channel" as const,
        slug: "chat-" + crypto.randomUUID(),
        additionalDirectories: [],
      },
      (p, basedOnControlRoomSeq, idempotencyKey) =>
        bridge.client.request("room.create", {
          ...p,
          basedOnControlRoomSeq,
          idempotencyKey,
        }),
    );
    progress.roomId = result.room.roomId;
  }
  const roomId = progress.roomId;
  if (!progress.instantiated) {
    await c.mutate(
      "instantiate",
      roomId,
      { roleId: role.roleId, channelId: roomId },
      (p, basedOnRoomSeq, idempotencyKey) =>
        bridge.client.request("role.instantiate", {
          ...p,
          basedOnRoomSeq,
          idempotencyKey,
        }),
    );
    progress.instantiated = true;
  }
  const { preferences } = await bridge.client.request("sidebar.get", {
      workspaceId: workspace.workspaceId,
    }),
    key = "room:" + roomId;
  const accepted =
    preferences.dmOrder.includes(key) && !preferences.hiddenDms.includes(key)
      ? preferences
      : await c.preferences(preferences.version, (p) => ({
          dmOrder: [...new Set([...p.dmOrder, key])],
          hiddenDms: p.hiddenDms.filter((k) => k !== key),
        }));
  const dto = await c.observe(async () => {
    const rows = await bridge.read("/channels/dm");
    const row = rows.find((r: any) => r.id === roomId);
    if (!row) throw Error("独立单聊已创建，列表尚未读到");
    return row;
  });
  steps.delete(role.roleId);
  return { ...dto, loomPreferences: accepted, prefsVersion: accepted.version };
}
