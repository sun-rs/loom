import {
  SidebarPatchRequestSchema,
  SidebarResponseSchema,
} from "@rah-os/protocol";
import {
  nativeRead,
  sdkRead,
  instant,
  workspaceId,
  nativeUser,
  humanId,
} from "./pixel-fixture.mjs";

export const channels = ["Alpha", "Beta", "Gamma"].map((name) => ({
  id: "fixture-" + name.toLowerCase(),
  name,
}));
export function interactionFixture(arm) {
  let sdk = structuredClone(sdkRead("/v3/client/sidebar/get"));
  sdk.preferences.channelOrder = channels.map((c) => "room:" + c.id);
  sdk.preferences.customSections = [
    { id: "work", name: "Work", emoji: null, sortMode: "manual", items: [] },
  ];
  sdk.preferences.sectionOrder = ["pinned", "custom:work", "channels", "dms"];
  // The reference speaks its own native API; it never calls Loom's mapper.
  let native = {
    ...structuredClone(nativeRead(`/servers/${workspaceId}/sidebar-order`)),
    pinnedVersion: 0,
    channelOrder: channels.map((c) => c.id),
    customSections: [
      { id: "work", name: "Work", emoji: null, sortMode: "manual" },
    ],
    sectionPlacements: [],
    sectionOrder: ["system:pinned", "work", "system:channels", "system:dms"],
  };
  const writes = [],
    receipts = new Map();
  const nativeChannel = (c) => ({
    id: c.id,
    serverId: workspaceId,
    name: c.name,
    description: null,
    type: "channel",
    createdAt: instant,
    archivedAt: null,
    joined: true,
    channelRole: "admin",
    guestVisible: false,
    guestJoinable: false,
    systemKey: null,
  });
  const sdkRoom = (c) => ({
    roomId: c.id,
    name: c.name,
    slug: c.name.toLowerCase(),
    workspaceId,
    kind: "channel",
    createdAt: instant,
  });
  return {
    writes,
    state() {
      if (arm === "reference")
        return {
          pinned: native.pinned,
          channelOrder: native.channelOrder,
          sections: native.customSections.map((s) => ({
            ...s,
            items: native.sectionPlacements
              .filter((p) => p.sectionId === s.id)
              .sort((a, b) => a.position - b.position)
              .map((p) => p.id),
          })),
          sectionOrder: native.sectionOrder,
          sort: native.channelSortMode,
        };
      const p = sdk.preferences;
      return {
        pinned: p.pinned.map((k) => ({ kind: "channel", id: k.slice(5) })),
        channelOrder: p.channelOrder.map((k) => k.slice(5)),
        sections: p.customSections.map((s) => ({
          ...s,
          emoji: s.emoji ?? null,
          sortMode: s.sortMode ?? "manual",
          items: s.items.map((k) => k.slice(5)),
        })),
        sectionOrder: p.sectionOrder.map((k) =>
          k.startsWith("custom:") ? k.slice(7) : "system:" + k,
        ),
        sort: p.channelSortMode,
      };
    },
    handle(path, method, input) {
      if (arm === "reference" && path.startsWith("/api/")) {
        path = path.slice(4);
        if (path === `/servers/${workspaceId}/sidebar-order`) {
          if (method === "PATCH") {
            writes.push(structuredClone(input));
            native = {
              ...native,
              ...input,
              sectionsVersion: native.sectionsVersion + 1,
              pinnedVersion: native.pinnedVersion + 1,
            };
          }
          return { json: native };
        }
        if (path === "/channels") return { json: channels.map(nativeChannel) };
        if (path === "/channels/unread") return { json: { channels: {} } };
        const channel = channels.find((c) => path.includes("/" + c.id));
        if (channel) {
          if (path === `/channels/${channel.id}`)
            return { json: nativeChannel(channel) };
          if (path.endsWith("/notification-settings"))
            return {
              json: {
                activityMuted: false,
                activityMuteSupported: true,
                muteFromSeq: null,
                prefsVersion: native.sectionsVersion,
              },
            };
          if (path.endsWith("/message-display-settings"))
            return {
              json: {
                collapseLongMessages: true,
                prefsVersion: native.sectionsVersion,
              },
            };
          if (path === `/messages/channel/${channel.id}`)
            return {
              json: {
                messages: [],
                hasMore: false,
                hasNewer: false,
                historyLimited: false,
              },
            };
          if (path === `/tasks/channel/${channel.id}`)
            return { json: { tasks: [] } };
          if (path.endsWith("/members"))
            return {
              json: {
                agents: [],
                humans: [
                  {
                    ...nativeUser,
                    role: "owner",
                    serverRole: "owner",
                    channelRole: "admin",
                  },
                ],
              },
            };
          if (path.endsWith("/read")) return { json: {} };
          if (path.endsWith("/active")) return { json: { uploads: [] } };
        }
        const data = nativeRead(path);
        if (data !== undefined && method === "GET") return { json: data };
      }
      if (arm === "loom") {
        if (path === "/v3/client/sidebar/get")
          return { json: SidebarResponseSchema.parse(sdk) };
        if (path === "/v3/client/sidebar/patch") {
          input = SidebarPatchRequestSchema.parse(input);
          if (receipts.has(input.idempotencyKey))
            return { json: receipts.get(input.idempotencyKey) };
          if (input.expectedVersion !== sdk.preferences.version)
            return {
              status: 409,
              json: {
                error: "stale_sidebar",
                message: "fixture version conflict",
              },
            };
          writes.push(structuredClone(input));
          sdk = SidebarResponseSchema.parse({
            ...sdk,
            preferences: {
              ...sdk.preferences,
              ...input.patch,
              version: sdk.preferences.version + 1,
            },
          });
          receipts.set(input.idempotencyKey, structuredClone(sdk));
          return { json: sdk };
        }
        if (path === "/v3/client/rooms/list")
          return { json: { rooms: channels.map(sdkRoom) } };
        if (path === "/v3/client/rooms/members/list")
          return {
            json: {
              memberships: [
                {
                  roomId: input.roomId,
                  principalId: humanId,
                  role: "owner",
                  joinedAt: instant,
                },
              ],
            },
          };
        if (path === "/v3/client/rooms/sync")
          return {
            json: {
              cursorBefore: 0,
              cursorAfter: 0,
              latestRoomSeq: 0,
              ...(input.bootstrap === "latest"
                ? {
                    eventFloorSeq: 0,
                    snapshotSeq: 0,
                    snapshot: {
                      room: sdkRoom(
                        channels.find((c) => c.id === input.roomId),
                      ),
                      members: [
                        {
                          principalId: humanId,
                          kind: "human",
                          handle: "Loom",
                          displayName: "Loom",
                        },
                      ],
                    },
                  }
                : { snapshot: null }),
              events: [],
            },
          };
        if (path === "/v3/client/rooms/timeline")
          return {
            json: {
              items: [],
              cursorBefore: 0,
              cursorAfter: 0,
              hasMoreBefore: false,
              hasMoreAfter: false,
            },
          };
        if (path === "/v3/client/rooms/acknowledge")
          return { json: { acknowledgedThrough: input.throughSeq } };
        if (path === "/v3/client/activity/mark")
          return {
            json: { readThroughSeq: input.throughSeq, doneThroughSeq: 0 },
          };
        if (path === "/v3/client/tasks/list") return { json: { tasks: [] } };
        const data = sdkRead(path);
        if (data !== undefined) return { json: data };
      }
    },
  };
}
