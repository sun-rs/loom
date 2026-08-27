import type { Room, Workspace } from "@rah-os/protocol";
import { activeMobileNavigation } from "@rah-os/ui-web";

import { Icon } from "./icon.tsx";

export type Tab = "chat" | "files" | "tasks";
export type Surface = "agents" | "computers" | "room";

export function Rail({
  active = "room",
  onSelect,
  onTasks,
}: {
  active?: Surface;
  onSelect?: (surface: Surface) => void;
  onTasks?: () => void;
}) {
  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail-head">
        <span className="rail-logo">R</span>
      </div>
      <div className="rail-primary">
        <RailButton disabled icon="search" label="搜索（待接入）" />
        <RailButton
          active={active === "room"}
          icon="chat"
          label="聊天"
          onClick={() => onSelect?.("room")}
        />
        <RailButton disabled icon="pulse" label="动态（待 Inbox）" />
        <RailButton
          icon="task"
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
          icon="monitor"
          label="计算机"
          onClick={() => onSelect?.("computers")}
        />
      </div>
      <div className="rail-footer-item">
        <RailButton disabled icon="bell" label="通知（待接入）" />
      </div>
      <div className="rail-footer-item">
        <RailButton disabled icon="gear" label="设置（待接入）" />
      </div>
    </nav>
  );
}

function RailButton({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`rail-btn${active ? " is-active" : ""}`}
      disabled={disabled || onClick === undefined}
      onClick={onClick}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}

export function RoomSidebar({
  activeRoomId,
  canCreate,
  mobileOpen,
  onClose,
  onCreate,
  onSelect,
  rooms,
  workspace,
}: {
  activeRoomId: string | undefined;
  canCreate: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  onCreate: () => void;
  onSelect: (roomId: string) => void;
  rooms: Room[];
  workspace: Workspace | undefined;
}) {
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
        <section className="side-section">
          <div className="side-title">
            <Icon name="chevron" />
            <span>Workspace</span>
            <span className="count">{rooms.length}</span>
          </div>
          <p className="side-hint">
            {workspace?.name ?? "没有可访问的 Workspace"}
          </p>
        </section>
        <section className="side-section">
          <div className="side-title">
            <Icon name="chevron" />
            <span>频道</span>
            <span className="count">{rooms.length}</span>
            <button
              aria-label="新建频道"
              className="rah-side-create"
              disabled={!canCreate}
              onClick={onCreate}
              title={canCreate ? "新建频道" : "当前 Workspace 不允许创建频道"}
            >
              +
            </button>
          </div>
          {rooms.map((room) => (
            <button
              key={room.roomId}
              className={`channel-row${room.roomId === activeRoomId ? " is-selected" : ""}`}
              onClick={() => onSelect(room.roomId)}
            >
              <span className="hash">#</span>
              {room.name}
            </button>
          ))}
        </section>
      </div>
    </aside>
  );
}

export function ChannelHeader({
  memberCount,
  onManageAgents,
  onOpenRooms,
  room,
}: {
  memberCount: number;
  onManageAgents: () => void;
  onOpenRooms: () => void;
  room: Room | undefined;
}) {
  return (
    <header className="channel-head">
      <button
        aria-label="打开 Room 列表"
        className="sq-btn rah-mobile-only"
        onClick={onOpenRooms}
      >
        <Icon name="menu" />
      </button>
      <div className="channel-id">
        <span className="channel-badge">
          <Icon name="hash" />
        </span>
        <div className="channel-title">
          <h1>{room?.name ?? "选择一个 Room"}</h1>
          <p className="channel-sub">RAH OS canonical Room</p>
        </div>
      </div>
      <div className="head-actions">
        <button className="sq-btn" disabled title="搜索尚未接入">
          <Icon name="search" />
        </button>
        <button
          className="sq-btn members"
          onClick={onManageAgents}
          title="查看和设置当前 Room 成员"
        >
          <Icon name="members" />
          <b>{memberCount}</b>
        </button>
      </div>
    </header>
  );
}

export function MobileNavigation({
  activeSurface,
  activeTab,
  onAgents,
  onChat,
  onRooms,
  onTasks,
  roomsOpen,
}: {
  activeSurface: Surface;
  activeTab: Tab;
  onAgents: () => void;
  onChat: () => void;
  onRooms: () => void;
  onTasks: () => void;
  roomsOpen: boolean;
}) {
  const activeDestination = activeMobileNavigation({
    activeSurface,
    activeTab,
    roomsOpen,
  });
  return (
    <nav className="rah-mobile-nav" aria-label="移动端主导航">
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
    </nav>
  );
}

function MobileNavigationButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "is-active" : undefined}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} />
      <span>{label}</span>
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
