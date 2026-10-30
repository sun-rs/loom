import {
  nativeRead,
  sdkRead,
  instant,
  workspaceId,
  humanId,
  nativeUser,
} from "./pixel-fixture.mjs";
export const roomId = "fixture-conversation",
  lastMessage = "FIXTURE conversation ready";
const principal = {
  principalId: humanId,
  kind: "human",
  handle: "Loom",
  displayName: "Loom",
};
const room = {
  roomId,
  workspaceId,
  name: "fixture-conversation",
  slug: "fixture-conversation",
  kind: "channel",
  createdAt: instant,
};
const texts = [
  "同一条消息，**相同字体与布局**。\n\n> 这是一段引用，用于核对官方引用字体。",
  "@Loom 请核对这条消息的显示名。",
  lastMessage,
];
// Native API oracle is intentionally independent of the production message mapper.
const nativeMessages = texts.map((content, i) => ({
  id: "fixture-message-" + i,
  channelId: roomId,
  seq: i + 1,
  senderId: humanId,
  senderType: "user",
  senderName: "Loom",
  senderDisplayName: "Loom",
  content,
  createdAt: instant,
  ...(i === 1
    ? { mentions: [{ type: "user", id: humanId, name: "Loom" }] }
    : {}),
}));
const messages = texts.map((body, i) => ({
  messageId: "fixture-message-" + i,
  roomId,
  roomSeq: i + 1,
  actorId: humanId,
  body,
  createdAt: instant,
  ...(i === 1
    ? { mentions: [{ principalId: humanId, handle: "Loom", start: 0, end: 5 }] }
    : {}),
}));
const nativeChannel = {
  id: roomId,
  serverId: workspaceId,
  name: room.name,
  description: null,
  type: "channel",
  createdAt: instant,
  archivedAt: null,
  joined: true,
  channelRole: "admin",
  guestVisible: false,
  guestJoinable: false,
  systemKey: null,
};
export function nativePopulated(path, method = "GET") {
  if (path === "/channels") return [nativeChannel];
  if (path === "/channels/" + roomId) return nativeChannel;
  if (path === "/channels/" + roomId + "/members")
    return {
      agents: [],
      humans: [
        {
          ...nativeUser,
          role: "owner",
          serverRole: "owner",
          channelRole: "admin",
        },
      ],
    };
  if (path === "/messages/channel/" + roomId)
    return {
      messages: nativeMessages,
      hasMore: false,
      hasNewer: false,
      historyLimited: false,
    };
  if (path === "/channels/" + roomId + "/notification-settings")
    return {
      activityMuted: false,
      activityMuteSupported: true,
      muteFromSeq: null,
      prefsVersion: 0,
    };
  if (path === "/channels/" + roomId + "/message-display-settings")
    return { collapseLongMessages: true, prefsVersion: 0 };
  if (path === "/tasks/channel/" + roomId) return { tasks: [] };
  if (path === "/channels/" + roomId + "/read" && method === "POST") return {};
  return nativeRead(path);
}
export function sdkPopulated(path, input = {}) {
  if (path === "/v3/client/rooms/members/list")
    return {
      memberships: [
        { roomId, principalId: humanId, role: "owner", joinedAt: instant },
      ],
    };
  if (path === "/v3/client/rooms/list") return { rooms: [room] };
  if (path === "/v3/client/rooms/sync")
    return {
      cursorBefore: 3,
      cursorAfter: 3,
      latestRoomSeq: 3,
      ...(input.bootstrap === "latest"
        ? {
            eventFloorSeq: 3,
            snapshotSeq: 3,
            snapshot: { room, members: [principal] },
          }
        : { snapshot: null }),
      events: [],
    };
  if (path === "/v3/client/rooms/acknowledge")
    return { acknowledgedThrough: input.throughSeq };
  if (path === "/v3/client/rooms/timeline") {
    const selected = messages.filter(
      (m) =>
        (input.afterSeq === undefined || m.roomSeq > input.afterSeq) &&
        (input.beforeSeq === undefined || m.roomSeq < input.beforeSeq),
    );
    return {
      items: selected.map((message) => ({ kind: "message", message })),
      cursorBefore: selected[0]?.roomSeq ?? input.afterSeq ?? 0,
      cursorAfter: selected.at(-1)?.roomSeq ?? input.afterSeq ?? 0,
      hasMoreBefore: false,
      hasMoreAfter: false,
    };
  }
  if (path === "/v3/client/activity/mark")
    return { readThroughSeq: input.throughSeq, doneThroughSeq: 0 };
  return sdkRead(path);
}
