// Fixed semantic fixture represented independently in native HTTP and Loom SDK contracts.
export const instant = "2026-10-30T00:00:00Z",
  humanId = "fixture-human",
  workspaceId = "fixture-workspace",
  controlId = "fixture-control",
  slug = "loom-fixture";
export const nativeUser = {
  id: humanId,
  name: "Loom",
  displayName: "Loom",
  email: "",
  description: null,
  avatarUrl: null,
  gravatarHash: "",
  emailVerified: true,
  profileSetupCompletedAt: instant,
  displayLanguage: "zh-CN",
  preferredLanguage: "zh-CN",
  preferredTimezone: null,
  preferredTimeFormat: null,
  preferredMessageBodyFontSize: "md",
};
export const nativeServer = {
  id: workspaceId,
  name: "Loom FIXTURE",
  slug,
  role: "owner",
  ownerId: humanId,
  createdAt: instant,
};
export function nativeRead(path) {
  return new Map([
    ["/auth/me", nativeUser],
    ["/servers", [nativeServer]],
    [
      `/servers/${workspaceId}/members`,
      [{ ...nativeUser, userId: humanId, user: nativeUser, role: "owner" }],
    ],
    [
      `/servers/${workspaceId}/settings`,
      {
        settings: { feedbackSettings: { enabled: false }, onboardSettings: {} },
      },
    ],
    [
      `/servers/${workspaceId}/sidebar-order`,
      {
        channelOrder: [],
        agentOrder: [],
        dmOrder: [],
        pinned: [],
        hiddenDmIds: [],
        sectionOrder: [],
        customSections: [],
        sectionPlacements: [],
        sectionsVersion: 0,
        channelSortMode: "manual",
        dmSortMode: "manual",
        pinnedSortMode: "manual",
      },
    ],
    [`/servers/${workspaceId}/machines`, []],
    [`/servers/${workspaceId}/model-label-catalog`, { machines: {} }],
    [
      `/servers/${workspaceId}/translation-settings`,
      {
        translationEnabled: false,
        translationAvailable: false,
        canManageTranslation: false,
      },
    ],
    [
      `/servers/${workspaceId}/setup-projection`,
      {
        surface: "none",
        phase: null,
        currentStep: null,
        blocksChat: false,
        allowedExits: [],
        sideEffectState: { transitions: "disabled", completion: "disabled" },
        gateReason: null,
      },
    ],
    [
      "/servers/unread-summary",
      [
        {
          serverId: workspaceId,
          unreadCount: 0,
          activityUnreadCount: 0,
          serverPushMuted: false,
        },
      ],
    ],
    ["/channels", []],
    ["/agents", []],
    ["/channels/dm", []],
    ["/channels/threads/followed", []],
    ["/channels/joint-invites", []],
    ["/channels/unread", []],
    [
      "/channels/inbox",
      {
        items: [],
        totalCount: 0,
        unreadCount: 0,
        totalUnreadCount: 0,
        hasMore: false,
      },
    ],
    [
      "/channels/saved",
      { saved: [], total: 0, globalTotal: 0, hasMore: false },
    ],
    ["/tasks/server", { tasks: [], next_cursor: null, total: 0 }],
    ["/announcements/active", []],
    ["/product-feedback/tickets", []],
    ["/product-events/config", { clientEventsAllowed: false }],
    ["/messages/attachment-preview/enabled", { enabled: false }],
  ]).get(path);
}
export function sdkRead(path) {
  return new Map([
    [
      "/v3/client/principals/me",
      {
        principal: {
          principalId: humanId,
          kind: "human",
          handle: "Loom",
          displayName: "Loom",
        },
      },
    ],
    [
      "/v3/client/workspaces/list",
      {
        workspaces: [
          {
            workspaceId,
            name: "Loom FIXTURE",
            slug,
            state: "active",
            controlRoomId: controlId,
            createdAt: instant,
          },
        ],
      },
    ],
    ["/v3/client/roles/list", { roles: [], instances: [], deletedRoles: [] }],
    ["/v3/client/agents/list", { agents: [] }],
    ["/v3/client/agents/presence/list", { agents: [], observedAt: instant }],
    ["/v3/client/rooms/list", { rooms: [] }],
    [
      "/v1/local/runtimes/list",
      {
        hostId: "fixture-computer",
        runtimes: [],
        restartRequiredToRescan: true,
      },
    ],
    [
      "/v3/client/sidebar/get",
      {
        recent: {},
        preferences: {
          version: 0,
          pinned: [],
          channelOrder: [],
          dmOrder: [],
          channelPanelTabOrder: [],
          hiddenDms: [],
          customSections: [],
          sectionOrder: [],
          mutedActivity: [],
          mutedWorkspace: false,
          notifyAllMessages: [],
          expandedLongMessages: [],
          channelSortMode: "manual",
          dmSortMode: "manual",
          pinnedSortMode: "manual",
        },
      },
    ],
    [
      "/v3/client/activity/list",
      { items: [], total: 0, summary: { unreadActivityCount: 0, rooms: [] } },
    ],
    ["/v3/client/messages/saved", { items: [], total: 0, globalTotal: 0 }],
    ["/v3/client/tasks/global", { tasks: [], total: 0 }],
  ]).get(path);
}
