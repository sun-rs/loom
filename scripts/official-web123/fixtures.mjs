// Independent native API fixtures. Never installed in production bindings.
export const user = {
  id: "fixture-human",
  name: "Loom",
  displayName: "Loom",
  email: "owner@example.invalid",
  emailVerified: true,
  description: null,
  avatarUrl: null,
  gravatarHash: "",
  profileSetupCompletedAt: "2026-10-30T00:00:00Z",
  displayLanguage: "zh-CN",
  preferredLanguage: "zh-CN",
  preferredTimezone: "Asia/Shanghai",
  preferredTimeFormat: "24h",
  preferredMessageBodyFontSize: "md",
  createdAt: "2026-10-30T00:00:00Z",
};
export const server = {
  id: "fixture-workspace",
  name: "Loom FIXTURE",
  slug: "loom-fixture",
  role: "owner",
  ownerId: user.id,
  createdAt: user.createdAt,
};
export function responseFor(request) {
  const url = new URL(request.url()),
    path = url.pathname.replace(/^\/api/, "");
  if (request.method() === "GET") {
    const rows = new Map([
      ["/auth/me", user],
      ["/servers", [server]],
      [
        `/servers/${server.id}/members`,
        [{ ...user, userId: user.id, user, role: "owner" }],
      ],
      [
        `/servers/${server.id}/sidebar-order`,
        {
          channelOrder: [],
          agentOrder: [],
          dmOrder: [],
          customSections: [],
          pinned: [],
          hiddenDmIds: [],
        },
      ],
      [
        `/servers/${server.id}/settings`,
        {
          settings: {
            onboardSettings: {},
            feedbackSettings: { enabled: false },
          },
        },
      ],
      [`/servers/${server.id}/machines`, []],
      [`/servers/${server.id}/model-label-catalog`, { machines: {} }],
      [
        "/servers/unread-summary",
        [
          {
            serverId: server.id,
            unreadCount: 0,
            activityUnreadCount: 0,
            serverPushMuted: false,
          },
        ],
      ],
      ["/agents", []],
      ["/channels", []],
      ["/channels/dm", []],
      ["/channels/threads/followed", []],
      [
        "/channels/inbox",
        { items: [], totalCount: 0, unreadCount: 0, hasMore: false },
      ],
      ["/channels/unread", []],
      ["/tasks/server", { tasks: [], next_cursor: null }],
      ["/messages/attachment-preview/enabled", { enabled: false }],
      ["/product-events/config", { clientEventsAllowed: false }],
    ]);
    if (rows.has(path)) return rows.get(path);
  }
  if (request.method() === "POST" && path === "/auth/me/timezone-observation")
    return user;
  return undefined;
}
