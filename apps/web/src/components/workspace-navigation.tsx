import type { Room, Workspace } from "@rah-os/protocol";
import { SidebarSection } from "./sidebar-section.tsx";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { directConversationEntries } from "../direct-conversation-entries.ts";
import {
  activeMobileNavigation,
  type WorkspaceAgentView,
} from "@rah-os/ui-web";

import { AgentAvatar } from "./agent-directory-pane.tsx";
import { Icon } from "./icon.tsx";
import {
  agentConnectionLabel,
  visibleNavigationDot,
} from "../attention-presentation.ts";

export type Tab = "chat" | "files" | "tasks";
export type Surface =
  | "agents"
  | "computers"
  | "room"
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
          active={active === "room"}
          dot={chatUnread}
          icon="chat"
          label="聊天"
          onClick={() => onSelect?.("room")}
        />
        <RailButton
          active={active === "activity"}
          dot={activityUnread}
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
      <div className="rail-footer-item">
        <RailButton
          active={notificationsOpen}
          badge={notificationCount}
          dot={notificationAttention && notificationCount === 0}
          keepDotWhileActive
          icon="bell"
          label="通知"
          {...(onNotifications === undefined
            ? {}
            : { onClick: onNotifications })}
        />
      </div>
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
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  badge?: number;
  dot?: boolean;
  keepDotWhileActive?: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={badge > 0 ? `${label}，${badge} 项待处理` : label}
      className={`rail-btn${active ? " is-active" : ""}`}
      disabled={disabled || onClick === undefined}
      onClick={onClick}
      title={label}
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
  );
}

export function RoomSidebar({
  activeRoomId,
  agents,
  canCreate,
  canMessage,
  currentHumanId,
  mobileOpen,
  onClose,
  onCreate,
  onOpenDirectRoom,
  onSelect,
  rooms,
  workspace,
  unreadRooms,
}: {
  activeRoomId: string | undefined;
  agents: readonly WorkspaceAgentView[];
  canCreate: boolean;
  canMessage: boolean;
  currentHumanId: string | undefined;
  mobileOpen: boolean;
  onClose: () => void;
  onCreate: () => void;
  onOpenDirectRoom: (peerPrincipalId: string) => Promise<void>;
  onSelect: (roomId: string) => void;
  rooms: Room[];
  workspace: Workspace | undefined;
  unreadRooms?:
    | readonly { roomId: string; unreadCount: number; hasMention: boolean }[]
    | undefined;
}) {
  const channels = rooms.filter(({ kind }) => kind !== "direct");
  const unread = (roomId: string | undefined) =>
    unreadRooms?.find((row) => row.roomId === roomId);
  const directEntries = directConversationEntries(
    agents,
    rooms,
    currentHumanId,
  );
  const opening = useRef(false);
  const [openingPeer, setOpeningPeer] = useState<string>();
  const [directError, setDirectError] = useState<string>();
  async function openPeer(peerId: string): Promise<void> {
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
  return (
    <aside
      aria-label="Room 列表"
      className={`sidebar rah-room-sidebar${mobileOpen ? " is-open" : ""}`}
    >
      <header className="sidebar-head">
        <span className="sidebar-title">聊天</span>
        <button
          aria-label="关闭 Room 列表"
          className="sq-btn rah-mobile-only"
          onClick={onClose}
        >
          <span className="rah-close-glyph" aria-hidden="true">
            ×
          </span>
        </button>
      </header>
      <div className="sidebar-body">
        <section className="side-section">
          <button className="sidebar-bookmarks" disabled title="收藏尚未接入">
            <Icon name="bookmark" />
            <span>已收藏</span>
          </button>
        </section>
        <SidebarSection label="Workspace" count={workspace ? 1 : 0}>
          <p className="side-hint">
            {workspace?.name ?? "没有可访问的 Workspace"}
          </p>
        </SidebarSection>
        <SidebarSection
          label="频道"
          count={channels.length}
          unread={channels.some(
            (room) => (unread(room.roomId)?.unreadCount ?? 0) > 0,
          )}
          action={
            <button
              aria-label="新建频道"
              className="rah-side-create"
              disabled={!canCreate}
              onClick={onCreate}
              title={canCreate ? "新建频道" : "当前 Workspace 不允许创建频道"}
            >
              +
            </button>
          }
        >
          {channels.map((room) => (
            <button
              key={room.roomId}
              className={`channel-row${room.roomId === activeRoomId ? " is-selected" : ""}`}
              onClick={() => onSelect(room.roomId)}
            >
              <span className="hash">#</span>
              {room.name}
              <UnreadCount value={unread(room.roomId)} />
            </button>
          ))}
        </SidebarSection>
        <SidebarSection
          label="私信"
          count={directEntries.length}
          unread={directEntries.some(
            (entry) => (unread(entry.roomId)?.unreadCount ?? 0) > 0,
          )}
        >
          {directError && (
            <p role="alert" className="side-hint">
              {directError}
            </p>
          )}
          {directEntries.length === 0 ? (
            <p className="side-hint">暂无可私信的成员</p>
          ) : (
            directEntries.map((entry) => {
              const peer = entry.agent;
              return (
                <button
                  key={entry.key}
                  aria-label={`私信 ${entry.label}`}
                  aria-current={
                    entry.roomId !== undefined && entry.roomId === activeRoomId
                      ? "page"
                      : undefined
                  }
                  aria-busy={openingPeer === entry.peerPrincipalId}
                  disabled={
                    openingPeer !== undefined ||
                    (entry.roomId === undefined && !canMessage)
                  }
                  className={`channel-row rah-direct-room-row${entry.roomId !== undefined && entry.roomId === activeRoomId ? " is-selected" : ""}`}
                  onClick={() =>
                    entry.roomId !== undefined
                      ? onSelect(entry.roomId)
                      : entry.peerPrincipalId !== undefined
                        ? void openPeer(entry.peerPrincipalId)
                        : undefined
                  }
                >
                  {peer === undefined ? (
                    <span
                      className="rah-direct-room-fallback"
                      aria-hidden="true"
                    >
                      {entry.label.slice(0, 1).toUpperCase()}
                    </span>
                  ) : (
                    <AgentAvatar agent={peer} size="sidebar" />
                  )}
                  <span>
                    <b>{entry.label}</b>
                    {peer?.role === undefined ? null : (
                      <small>{peer.role}</small>
                    )}
                  </span>
                  <UnreadCount value={unread(entry.roomId)} />
                </button>
              );
            })
          )}
        </SidebarSection>
      </div>
    </aside>
  );
}

function UnreadCount({
  value,
}: {
  value: { unreadCount: number; hasMention: boolean } | undefined;
}) {
  return value && value.unreadCount > 0 ? (
    <span
      className="rah-room-unread"
      aria-label={`${value.unreadCount} 条未读${value.hasMention ? "，包含提及" : ""}`}
    >
      {value.unreadCount > 99 ? "99+" : value.unreadCount}
    </span>
  ) : null;
}

export function ChannelHeader({
  onSearch,
  directPeer,
  memberCount,
  onManageAgents,
  onOpenRooms,
  room,
}: {
  onSearch: () => void;
  directPeer: WorkspaceAgentView | undefined;
  memberCount: number;
  onManageAgents: () => void;
  onOpenRooms: () => void;
  room: Room | undefined;
}) {
  const direct = room?.kind === "direct";
  const title = directPeer?.displayName ?? room?.name ?? "选择一个 Room";
  return (
    <header className="channel-head">
      <button
        aria-label="打开 Room 列表"
        className="sq-btn rah-mobile-only"
        onClick={onOpenRooms}
      >
        <Icon name="menu" />
      </button>
      <div className={`channel-id${direct ? " is-direct" : ""}`}>
        {direct ? (
          directPeer === undefined ? (
            <span className="rah-direct-header-fallback" aria-hidden="true">
              {title.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <AgentAvatar agent={directPeer} size="header" />
          )
        ) : (
          <span className="channel-badge">
            <Icon name="hash" />
          </span>
        )}
        <div className="channel-title">
          <h1>{title}</h1>
          <p className={`channel-sub${direct ? " rah-direct-status" : ""}`}>
            {direct
              ? directPeer
                ? agentConnectionLabel(directPeer)
                : "状态未知"
              : (room?.description ?? "RAH OS canonical Room")}
          </p>
        </div>
      </div>
      {direct ? null : (
        <div className="head-actions">
          <button
            className="sq-btn"
            onClick={onSearch}
            aria-label="搜索当前对话"
            title="搜索当前对话"
          >
            <Icon name="search" />
          </button>
          <button
            className="sq-btn"
            onClick={onManageAgents}
            aria-label="频道详情与设置"
            title={`频道详情与设置（${memberCount} 位成员）`}
          >
            <Icon name="settings" />
          </button>
        </div>
      )}
    </header>
  );
}

export function MobileNavigation({
  onSearch,
  onActivity,
  activeSurface,
  activeTab,
  notificationCount,
  notificationAttention = false,
  notificationsOpen,
  onAgents,
  onChat,
  onNotifications,
  onRooms,
  onSettings,
  onTasks,
  roomsOpen,
}: {
  onSearch: () => void;
  onActivity: () => void;
  activeSurface: Surface;
  activeTab: Tab;
  notificationCount: number;
  notificationAttention?: boolean;
  notificationsOpen: boolean;
  onAgents: () => void;
  onChat: () => void;
  onNotifications: () => void;
  onRooms: () => void;
  onSettings: () => void;
  onTasks: () => void;
  roomsOpen: boolean;
}) {
  const activeDestination = activeMobileNavigation({
    activeSurface,
    activeTab,
    notificationsOpen,
    roomsOpen,
  });
  return (
    <nav className="rah-mobile-nav" aria-label="移动端主导航">
      <MobileNavigationButton
        active={activeSurface === "search"}
        icon="search"
        label="搜索"
        onClick={onSearch}
      />
      <MobileNavigationButton
        active={activeSurface === "activity"}
        icon="pulse"
        label="动态"
        onClick={onActivity}
      />
      <MobileNavigationButton
        active={activeDestination === "rooms"}
        icon="menu"
        label="Rooms"
        onClick={onRooms}
      />
      <MobileNavigationButton
        active={activeDestination === "chat"}
        icon="chat"
        label="聊天"
        onClick={onChat}
      />
      <MobileNavigationButton
        active={activeDestination === "tasks"}
        icon="task"
        label="任务"
        onClick={onTasks}
      />
      <MobileNavigationButton
        active={activeDestination === "agents"}
        icon="members"
        label="Agents"
        onClick={onAgents}
      />
      <MobileNavigationButton
        active={activeDestination === "notifications"}
        badge={notificationCount}
        dot={notificationAttention && notificationCount === 0}
        icon="bell"
        label="Inbox"
        onClick={onNotifications}
      />
      <MobileNavigationButton
        active={activeDestination === "settings"}
        icon="gear"
        label="设置"
        onClick={onSettings}
      />
    </nav>
  );
}

function MobileNavigationButton({
  active,
  badge = 0,
  dot = false,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  badge?: number;
  dot?: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={
        badge > 0
          ? `${label}，${badge} 项待处理`
          : dot
            ? `${label}，有待处理事项`
            : label
      }
      className={active ? "is-active" : undefined}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} />
      <span>{label}</span>
      {dot && <span className="rah-status-dot" aria-hidden="true" />}
      {badge > 0 ? (
        <b className="rah-mobile-nav-badge" aria-hidden="true">
          {badge > 99 ? "99+" : badge}
        </b>
      ) : null}
    </button>
  );
}

export function TabButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`tab${active ? " is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      role="tab"
      aria-selected={active}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}
