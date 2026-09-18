import { useMobileLayout } from "../use-mobile-layout.ts";
import { sidebarPreviewPatch } from "../sidebar-drag-layout.ts";
import { SidebarSortableGroup } from "./sidebar-drag.tsx";
import { SidebarGroupActions } from "./sidebar-group-actions.tsx";
import {
  ChatContextActions,
  type ChatContextControl,
} from "./chat-context-actions.tsx";
import { HintTooltip } from "@rah-os/ui-web/neo-brutalist/tooltip";
import { RailHelpMenu } from "./rail-help-menu.tsx";
import { InteractivePopoverTrigger } from "@rah-os/ui-web/neo-brutalist/interactive-popover";
import type { Room, Workspace } from "@rah-os/protocol";
import { DEFAULT_SIDEBAR_PREFERENCES } from "@rah-os/protocol";
import { useSidebarPreferences } from "./sidebar-preferences.tsx";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelHeaderIcon } from "@rah-os/ui-web/neo-brutalist/panel-header-icon";
import {
  SidebarDrag,
  SidebarDragItem,
  SidebarDropZone,
} from "./sidebar-drag.tsx";
import { sortSidebar, type SidebarSectionId } from "../sidebar-order.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { SidebarSection } from "./sidebar-section.tsx";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { directConversationEntries } from "../direct-conversation-entries.ts";
import { type WorkspaceAgentView } from "@rah-os/ui-web";

import { AgentAvatar } from "./agent-avatar.tsx";
import { AgentStatusDot } from "./agent-status-dot.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import {
  ChannelRowIdentity,
  RoomAttentionBadges,
} from "./sidebar-attention.tsx";
import { WorkspaceActivityFooter } from "./workspace-activity-footer.tsx";
import {
  agentConnectionLabel,
  agentPresencePresentation,
  visibleNavigationDot,
} from "../attention-presentation.ts";
import { roomActivityMuted } from "../room-preferences.ts";

export type Tab = "chat" | "files" | "tasks";
export type Surface =
  | "agents"
  | "computers"
  | "room"
  | "saved"
  | "settings"
  | "tasks"
  | "search"
  | "activity";

export function Rail({
  identity,
  active = "room",
  notificationCount = 0,
  activityUnread = false,
  chatUnread = false,
  computerAttention = false,
  notificationAttention = false,
  notificationsOpen = false,
  onNotifications,
  onSelect,
  onTasks,
}: {
  identity?: ReactNode;
  active?: Surface;
  notificationCount?: number;
  activityUnread?: boolean;
  chatUnread?: boolean;
  computerAttention?: boolean;
  notificationAttention?: boolean;
  notificationsOpen?: boolean;
  onNotifications?: () => void;
  onSelect?: (surface: Surface) => void;
  onTasks?: () => void;
}) {
  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail-head">
        {identity ?? <span className="rail-logo">?</span>}
      </div>
      <div className="rail-primary">
        <RailButton
          active={active === "search"}
          icon="search"
          label="搜索"
          onClick={() => onSelect?.("search")}
        />
        <RailButton
          active={active === "room" || active === "saved"}
          dot={chatUnread}
          icon="chat"
          label="聊天"
          onClick={() => onSelect?.("room")}
        />
        <RailButton
          active={active === "activity"}
          dot={activityUnread}
          keepDotWhileActive
          icon="pulse"
          label="动态"
          onClick={() => onSelect?.("activity")}
        />
        <RailButton
          icon="task"
          active={active === "tasks"}
          label="任务"
          {...(onTasks === undefined ? {} : { onClick: onTasks })}
        />
        <RailButton
          active={active === "agents"}
          icon="members"
          label="Agent 与成员"
          onClick={() => onSelect?.("agents")}
        />
        <RailButton
          active={active === "computers"}
          dot={computerAttention}
          icon="monitor"
          label="计算机"
          onClick={() => onSelect?.("computers")}
        />
      </div>
      <div className="rail-footer-item rail-footer-item--notifications">
        <InteractivePopoverTrigger
          hover
          render={
            <RailButton
              active={notificationsOpen}
              badge={notificationCount}
              dot={notificationAttention && notificationCount === 0}
              keepDotWhileActive
              tooltip={false}
              icon="bell"
              label="通知"
              {...(onNotifications === undefined
                ? {}
                : { onClick: onNotifications })}
            />
          }
        />
      </div>
      <RailHelpMenu />
      <div className="rail-footer-item">
        <RailButton
          active={active === "settings"}
          icon="gear"
          label="设置"
          onClick={() => onSelect?.("settings")}
        />
      </div>
    </nav>
  );
}

function RailButton({
  active = false,
  badge = 0,
  dot = false,
  keepDotWhileActive = false,
  tooltip = true,
  disabled = false,
  icon,
  label,
  onClick,
  ...buttonProps
}: React.ComponentProps<"button"> & {
  active?: boolean;
  badge?: number;
  dot?: boolean;
  keepDotWhileActive?: boolean;
  tooltip?: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <HintTooltip content={label} disabled={!tooltip}>
      <button
        {...buttonProps}
        aria-label={badge > 0 ? `${label}，${badge} 项待处理` : label}
        className={`rail-btn${active ? " is-active" : ""}`}
        disabled={
          disabled ||
          (onClick === undefined && buttonProps["aria-haspopup"] !== "dialog")
        }
        onClick={onClick}
        data-has-unread={dot || badge > 0}
      >
        <Icon name={icon} />
        {visibleNavigationDot(dot, active && !keepDotWhileActive) && (
          <span className="rah-status-dot" aria-hidden="true" />
        )}
        {badge > 0 ? (
          <span className="rah-rail-badge" aria-hidden="true">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>
    </HintTooltip>
  );
}

export function RoomSidebar({
  activeRoomId,
  contextControl,
  agents,
  canCreate,
  canMessage,
  currentHumanId,
  mobileOpen,
  mobileWorkspaceIdentity,
  notificationAttention = false,
  notificationCount = 0,
  onActivity,
  onCreate,
  onNotifications,
  onOpenDirectRoom,
  onSearch,
  onSelect,
  rooms,
  workspace,
  unreadRooms,
  onSaved,
  savedActive = false,
}: {
  activeRoomId: string | undefined;
  contextControl: ChatContextControl;
  agents: readonly WorkspaceAgentView[];
  canCreate: boolean;
  canMessage: boolean;
  currentHumanId: string | undefined;
  mobileOpen: boolean;
  mobileWorkspaceIdentity?: ReactNode;
  notificationAttention?: boolean;
  notificationCount?: number;
  onActivity: () => void;
  onCreate: () => void;
  onNotifications?: () => void;
  onOpenDirectRoom: (peerPrincipalId: string) => Promise<void>;
  onSearch: () => void;
  onSelect: (roomId: string) => void;
  rooms: Room[];
  workspace: Workspace | undefined;
  unreadRooms?:
    | readonly { roomId: string; unreadCount: number; hasMention: boolean }[]
    | undefined;
  onSaved?: (() => void) | undefined;
  savedActive?: boolean;
}) {
  const preferences = useSidebarPreferences(),
    p = preferences?.data?.preferences ?? DEFAULT_SIDEBAR_PREFERENCES;
  const unread = (roomId: string | undefined) =>
    unreadRooms?.find((row) => row.roomId === roomId);
  const workspaceRooms = rooms.filter(
    (room) =>
      room.workspaceId === workspace?.workspaceId &&
      room.archivedAt === undefined,
  );
  const directEntries = directConversationEntries(
    agents,
    workspaceRooms,
    currentHumanId,
  );
  type Entry = {
    key: string;
    label: string;
    room?: Room;
    direct?: (typeof directEntries)[number];
  };
  const all: Entry[] = [
    ...workspaceRooms
      .filter((room) => room.kind === "channel")
      .map((room) => ({ key: `room:${room.roomId}`, label: room.name, room })),
    ...directEntries
      .filter(
        (entry) =>
          !p.hiddenDms.includes(`peer:${entry.peerPrincipalId ?? entry.key}`),
      )
      .map((entry) => ({
        key: `peer:${entry.peerPrincipalId ?? entry.key}`,
        label: entry.label,
        direct: entry,
      })),
  ];
  const group = (section: SidebarSectionId) =>
    sortSidebar(
      all.filter((row) =>
        section === "pinned"
          ? p.pinned.includes(row.key)
          : !p.pinned.includes(row.key) &&
            !p.customSections.some((s) => s.items.includes(row.key)) &&
            (section === "channels" ? !!row.room : !!row.direct),
      ),
      section === "pinned"
        ? p.pinnedSortMode
        : section === "channels"
          ? p.channelSortMode
          : p.dmSortMode,
      section === "pinned"
        ? p.pinned
        : section === "channels"
          ? p.channelOrder
          : p.dmOrder,
      preferences?.data?.recent ?? {},
    );
  const opening = useRef(false);
  const [openingPeer, setOpeningPeer] = useState<string>();
  const [directError, setDirectError] = useState<string>();
  async function openPeer(peerId: string) {
    if (opening.current) return;
    opening.current = true;
    setOpeningPeer(peerId);
    setDirectError(undefined);
    try {
      await onOpenDirectRoom(peerId);
    } catch (error) {
      setDirectError(error instanceof Error ? error.message : "无法打开私信");
    } finally {
      opening.current = false;
      setOpeningPeer(undefined);
    }
  }
  const disabled = !preferences?.data || preferences.pending;
  const pin = (key: string) => {
    if (disabled) return;
    void preferences.patch({
      pinned: p.pinned.includes(key)
        ? p.pinned.filter((id) => id !== key)
        : [...p.pinned, key],
      customSections: p.customSections.map((s) => ({
        ...s,
        items: s.items.filter((id) => id !== key),
      })),
    });
  };
  const sectionIds = [
    ...new Set([
      ...p.sectionOrder,
      "pinned",
      "channels",
      "dms",
      ...p.customSections.map((s) => `custom:${s.id}`),
    ]),
  ].filter(
    (id) =>
      ["pinned", "channels", "dms"].includes(id) ||
      p.customSections.some((s) => `custom:${s.id}` === id),
  );
  const mobile = useMobileLayout();
  // Hidden mobile rows must stay unselected too: removing pink only when
  // opening the list would animate its 150ms fade into the return transition.
  const showConversationSelection = !mobile;
  const render = (row: Entry, section: SidebarSectionId) => {
    const room = row.room,
      entry = row.direct,
      peer = entry?.agent;
    const channelMuted =
      room !== undefined && roomActivityMuted(p.mutedActivity, room.roomId);
    return (
      <SidebarDragItem
        key={row.key}
        itemKey={row.key}
        section={section}
        disabled={disabled}
        onPin={() => pin(row.key)}
        pinned={p.pinned.includes(row.key)}
      >
        <ChatContextActions
          control={contextControl}
          target={{
            key: row.key,
            name: row.label,
            channel: !!room,
            permanent: room?.slug === "all",
            hasUnread:
              (unread(room?.roomId ?? entry?.roomId)?.unreadCount ?? 0) > 0,
            ...(room?.roomId
              ? { roomId: room.roomId }
              : entry?.roomId
                ? { roomId: entry.roomId }
                : {}),
          }}
        >
          <div>
            {room ? (
              <div className="rah-sidebar-channel-entry">
                <button
                  className={`channel-row${showConversationSelection && room.roomId === activeRoomId && !savedActive ? " is-selected" : ""}`}
                  onClick={() => onSelect(room.roomId)}
                >
                  <Icon
                    name={room.visibility === "private" ? "lock" : "hash"}
                    className="row-icon"
                  />
                  <ChannelRowIdentity muted={channelMuted} name={room.name} />
                  <RoomAttentionBadges
                    kind="channel"
                    quiet={channelMuted}
                    value={unread(room.roomId)}
                  />
                </button>
              </div>
            ) : entry ? (
              <button
                aria-label={`私信 ${entry.label}`}
                aria-current={
                  entry.roomId !== undefined &&
                  entry.roomId === activeRoomId &&
                  !savedActive
                    ? "page"
                    : undefined
                }
                aria-busy={openingPeer === entry.peerPrincipalId}
                disabled={
                  openingPeer !== undefined ||
                  (entry.roomId === undefined && !canMessage)
                }
                className={`channel-row rah-direct-room-row${showConversationSelection && entry.roomId !== undefined && entry.roomId === activeRoomId && !savedActive ? " is-selected" : ""}`}
                onClick={() =>
                  entry.roomId !== undefined
                    ? onSelect(entry.roomId)
                    : entry.peerPrincipalId !== undefined
                      ? void openPeer(entry.peerPrincipalId)
                      : undefined
                }
              >
                {peer === undefined ? (
                  <span className="rah-direct-room-fallback" aria-hidden="true">
                    {entry.label.slice(0, 1).toUpperCase()}
                  </span>
                ) : (
                  <AgentAvatar agent={peer} size="sidebar" />
                )}
                <span className="rah-direct-row-identity">
                  <span className="rah-direct-row-name">{entry.label}</span>
                  {peer?.description ? <small>{peer.description}</small> : null}
                </span>
                <RoomAttentionBadges
                  kind="direct"
                  value={unread(entry.roomId)}
                />
              </button>
            ) : null}
          </div>
        </ChatContextActions>
      </SidebarDragItem>
    );
  };
  return (
    <aside
      aria-label="Room 列表"
      className={`sidebar rah-room-sidebar${mobileOpen ? " is-open" : ""}`}
    >
      <PanelHeader kind="sidebar" className="sidebar-head">
        <span className="sidebar-title rah-desktop-only">聊天</span>
        <div className="rah-mobile-home-workspace rah-mobile-only">
          {mobileWorkspaceIdentity ?? workspace?.name ?? "RAH OS"}
        </div>
        <InteractivePopoverTrigger
          render={
            <button
              aria-label={
                notificationCount > 0
                  ? `通知，${notificationCount} 项待处理`
                  : "通知"
              }
              className="rah-mobile-home-notifications rah-mobile-only"
              data-has-unread={notificationAttention || notificationCount > 0}
              onClick={onNotifications}
              type="button"
            >
              <Icon name="bell" />
              {notificationCount > 0 ? (
                <span
                  className="rah-mobile-home-notification-badge"
                  aria-hidden
                >
                  {notificationCount > 99 ? "99+" : notificationCount}
                </span>
              ) : null}
            </button>
          }
        />
      </PanelHeader>
      <ChatContextActions control={contextControl}>
        <div className="sidebar-body">
          <section className="side-section">
            <button
              className="sidebar-bookmarks rah-mobile-home-entry rah-mobile-only"
              onClick={onSearch}
              type="button"
            >
              <Icon name="search" />
              <span>搜索</span>
            </button>
            <button
              className="sidebar-bookmarks rah-mobile-home-entry rah-mobile-only"
              onClick={onActivity}
              type="button"
            >
              <Icon name="pulse" />
              <span>动态</span>
            </button>
            <button
              className={`sidebar-bookmarks${showConversationSelection && savedActive ? " is-selected" : ""}`}
              disabled={!onSaved}
              onClick={onSaved}
            >
              <Icon name="bookmark" />
              <span>已保存</span>
            </button>
          </section>
          {directError && (
            <p role="alert" className="side-hint">
              {directError}
            </p>
          )}
          {preferences?.error && (
            <p role="alert" className="side-hint">
              {preferences.error}
            </p>
          )}
          <SidebarDrag
            layout={{
              version: p.version,
              sections: sectionIds,
              items: Object.fromEntries(
                sectionIds.map((id) => {
                  const custom = p.customSections.find(
                    (s) => `custom:${s.id}` === id,
                  );
                  return [
                    id,
                    custom
                      ? custom.items.filter(
                          (key) =>
                            all.some((row) => row.key === key) &&
                            !p.pinned.includes(key),
                        )
                      : group(id as SidebarSectionId).map((row) => row.key),
                  ];
                }),
              ),
            }}
            disabled={disabled}
            manualSections={sectionIds.filter(
              (id) =>
                id.startsWith("custom:") ||
                (id === "pinned"
                  ? p.pinnedSortMode
                  : id === "channels"
                    ? p.channelSortMode
                    : p.dmSortMode) === "manual",
            )}
            onCommit={async (layout) => {
              if (disabled || layout.version !== p.version) return false;
              return preferences.patch(
                sidebarPreviewPatch(
                  p,
                  layout,
                  new Set(all.map((row) => row.key)),
                ),
              );
            }}
            labels={Object.fromEntries([
              ...all.map((row) => [row.key, row.label]),
              ...sectionIds.map((id) => [
                `group:${id}`,
                p.customSections.find((s) => `custom:${s.id}` === id)?.name ??
                  { pinned: "已置顶", channels: "频道", dms: "私信" }[
                    id as "pinned" | "channels" | "dms"
                  ],
              ]),
            ])}
          >
            {(layout) =>
              layout.sections.map((id) => {
                const section = id as SidebarSectionId;
                const custom = p.customSections.find(
                  (s) => `custom:${s.id}` === id,
                );
                if (custom) {
                  const rows = (layout.items[id] ?? []).flatMap((key) => {
                    const row = all.find((r) => r.key === key);
                    return row ? [row] : [];
                  });
                  return (
                    <SidebarSortableGroup key={id} id={id} disabled={disabled}>
                      <SidebarGroupActions id={id}>
                        <div>
                          <SidebarDropZone
                            section={section}
                            items={rows.map((r) => r.key)}
                          >
                            <SidebarSection
                              label={[custom.emoji, custom.name]
                                .filter(Boolean)
                                .join(" ")}
                              sectionId={id}
                              count={rows.length}
                            >
                              {rows.length ? (
                                rows.map((row) => render(row, section))
                              ) : (
                                <p className="side-hint">暂无会话</p>
                              )}
                            </SidebarSection>
                          </SidebarDropZone>
                        </div>
                      </SidebarGroupActions>
                    </SidebarSortableGroup>
                  );
                }
                const rows = (layout.items[id] ?? []).flatMap((key) => {
                    const row = all.find((r) => r.key === key);
                    return row ? [row] : [];
                  }),
                  label =
                    section === "pinned"
                      ? "已置顶"
                      : section === "channels"
                        ? "频道"
                        : "私信",
                  field =
                    section === "pinned"
                      ? "pinnedSortMode"
                      : section === "channels"
                        ? "channelSortMode"
                        : "dmSortMode";
                return (
                  <SidebarSortableGroup
                    key={section}
                    id={section}
                    disabled={disabled}
                  >
                    <SidebarGroupActions id={section}>
                      <div>
                        <SidebarDropZone
                          section={section}
                          items={rows.map((r) => r.key)}
                        >
                          <SidebarSection
                            label={label}
                            sectionId={section}
                            count={rows.length}
                            unread={rows.some(
                              (row) =>
                                (unread(row.room?.roomId ?? row.direct?.roomId)
                                  ?.unreadCount ?? 0) > 0,
                            )}
                            action={
                              <div className="rah-sidebar-section-actions">
                                <DiscoveryFilter
                                  label={`${label}排序`}
                                  icon="arrow-up-down"
                                  className="rah-sidebar-sort"
                                  variant="sidebar"
                                  triggerLabel=""
                                  triggerAriaLabel={`${label}排序`}
                                  multiple={false}
                                  searchable={false}
                                  clearable={false}
                                  selected={false}
                                  showCount={false}
                                  disabled={disabled}
                                  values={[p[field]]}
                                  options={[
                                    { id: "manual", label: "手动" },
                                    { id: "recent", label: "最近" },
                                    { id: "az", label: "A-Z" },
                                  ]}
                                  onChange={([mode]) => {
                                    if (mode)
                                      void preferences?.patch({
                                        [field]: mode,
                                      });
                                  }}
                                />
                                {section === "channels" && (
                                  <button
                                    aria-label="新建频道"
                                    className="rah-side-create rah-interaction-flat"
                                    disabled={!canCreate}
                                    onClick={onCreate}
                                    title="新建频道"
                                  >
                                    <Icon name="plus" />
                                  </button>
                                )}
                              </div>
                            }
                          >
                            {rows.length ? (
                              rows.map((row) => render(row, section))
                            ) : (
                              <p className="side-hint">
                                {section === "pinned"
                                  ? "将频道或私信拖到这里置顶"
                                  : section === "channels"
                                    ? "还没有频道"
                                    : "暂无可私信的成员"}
                              </p>
                            )}
                          </SidebarSection>
                        </SidebarDropZone>
                      </div>
                    </SidebarGroupActions>
                  </SidebarSortableGroup>
                );
              })
            }
          </SidebarDrag>
        </div>
      </ChatContextActions>
      <WorkspaceActivityFooter agents={agents} />
    </aside>
  );
}

export function ChannelHeader({
  onSearch,
  onCloseSearchPreview,
  directPeer,
  memberCount,
  onManageAgents,
  onOpenDirectPeer,
  onOpenRooms,
  room,
}: {
  onSearch: () => void;
  onCloseSearchPreview?: (() => void) | undefined;
  directPeer: WorkspaceAgentView | undefined;
  memberCount: number;
  onManageAgents: () => void;
  onOpenDirectPeer: (agentDefinitionId: string) => void;
  onOpenRooms: () => void;
  room: Room | undefined;
}) {
  const direct = room?.kind === "direct";
  const title = directPeer?.displayName ?? room?.name ?? "选择一个 Room";
  return (
    <PanelHeader kind="conversation" className="rah-conversation-head">
      <PanelHeaderAction
        aria-label={onCloseSearchPreview ? "返回搜索结果" : "返回主页"}
        className="rah-mobile-only rah-mobile-back"
        onClick={onCloseSearchPreview ?? onOpenRooms}
      >
        <Icon name="arrow-left" />
      </PanelHeaderAction>
      <div className={`channel-id${direct ? " is-direct" : ""}`}>
        {direct ? (
          directPeer === undefined ? (
            <span className="rah-direct-header-fallback" aria-hidden="true">
              {title.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <button
              aria-label={`打开 ${directPeer.displayName} Agent 资料`}
              className="rah-direct-header-avatar"
              onClick={() => onOpenDirectPeer(directPeer.agentDefinitionId)}
              title="Agent 资料"
              type="button"
            >
              <AgentAvatar agent={directPeer} size="header" />
            </button>
          )
        ) : (
          <PanelHeaderIcon name="hash" glyphSize={14} />
        )}
        <div className={`channel-title${direct ? " rah-direct-title" : ""}`}>
          <h1 className="rah-panel-title">{title}</h1>
          <p
            className={`channel-sub${direct ? " rah-direct-status" : ""}`}
            data-presence={
              directPeer
                ? agentPresencePresentation(directPeer).activity
                : "offline"
            }
          >
            {direct && directPeer ? (
              <AgentStatusDot
                className="rah-header-presence"
                activity={agentPresencePresentation(directPeer).activity}
                label={agentConnectionLabel(directPeer)}
                size="sm"
              />
            ) : null}
            {direct
              ? directPeer
                ? agentConnectionLabel(directPeer)
                : "状态未知"
              : (room?.description ?? "RAH OS canonical Room")}
          </p>
        </div>
        {!direct && room?.archivedAt !== undefined ? (
          <span className="rah-channel-archived-badge">已归档</span>
        ) : null}
      </div>
      {!direct || onCloseSearchPreview ? (
        <div className="head-actions">
          {!direct && (
            <>
              <PanelHeaderAction
                onClick={onSearch}
                aria-label="搜索当前对话"
                title="搜索当前对话"
              >
                <Icon name="search" />
              </PanelHeaderAction>
              <PanelHeaderAction
                className="rah-channel-options"
                onClick={onManageAgents}
                aria-label="频道详情与设置"
                title={`频道详情与设置（${memberCount} 位成员）`}
              >
                <Icon name="settings" />
              </PanelHeaderAction>
            </>
          )}
          {onCloseSearchPreview ? (
            <PanelHeaderAction
              className="rah-search-preview-close"
              aria-label="关闭搜索预览"
              onClick={onCloseSearchPreview}
            >
              <Icon name="x" />
            </PanelHeaderAction>
          ) : null}
        </div>
      ) : null}
    </PanelHeader>
  );
}
