import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { ChannelSettingsHeader } from "./channel-settings-header.tsx";
import { HideAllChannelAction } from "./system-channel-settings.tsx";
import { useOverlayDrawerMotion } from "../use-overlay-drawer-motion.ts";
import type { ReactNode } from "react";
import { RoomMemberRemoveConfirmation } from "./room-member-remove-confirmation.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useEffect, useRef, useState } from "react";

import type { Principal, Room, RoomMembership } from "@rah-os/protocol";
import {
  roomAgentCandidates,
  roomSlugFromName,
  type WorkspaceAgentView,
} from "@rah-os/ui-web";

import { useDialogProtocol } from "../dialog-protocol.ts";
import { RoomVisibilityConfirmation } from "./room-visibility-confirmation.tsx";
import { AgentAvatar } from "./agent-directory-pane.tsx";
import { RoomMemberPage } from "./room-member-pages.tsx";
import { useSidebarPreferences } from "./sidebar-preferences.tsx";
import {
  roomActivityMuted,
  roomLongMessagesCollapsed,
  setRoomPreference,
} from "../room-preferences.ts";

export type AgentMembershipIdentity = Pick<
  WorkspaceAgentView,
  "agentDefinitionId" | "handle" | "participantId"
>;

export function RoomCreateDialog({
  agents,
  archivedRooms,
  canUnarchive,
  onClose,
  onCreate,
  onUnarchive,
}: {
  agents: readonly WorkspaceAgentView[];
  archivedRooms: readonly Room[];
  canUnarchive: boolean;
  onClose: () => void;
  onCreate: (input: {
    description?: string;
    initialAgentParticipantIds: string[];
    name: string;
    slug: string;
    visibility: "private" | "public";
  }) => Promise<void>;
  onUnarchive: (room: Room) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("public");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [archivedCollision, setArchivedCollision] = useState<Room>();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const slug = roomSlugFromName(name);
  const valid = name.trim().length > 0 && slug.length > 0;
  const normalizedSearch = memberSearch.trim().toLocaleLowerCase();
  const visibleAgents = agents.filter(
    (agent) =>
      normalizedSearch.length === 0 ||
      agent.displayName.toLocaleLowerCase().includes(normalizedSearch) ||
      agent.handle.toLocaleLowerCase().includes(normalizedSearch),
  );
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭新建频道窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-room-create-title"
        aria-modal="true"
        className="rah-dialog rah-room-create-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-room-create-title">创建频道</h2>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn rah-card-dialog-close"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              <Icon name="x" />
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (pending || !valid) return;
            const collision = archivedRooms.find((room) => room.slug === slug);
            if (collision !== undefined) {
              setArchivedCollision(collision);
              setActionError(undefined);
              return;
            }
            setPending(true);
            void onCreate({
              ...(description.trim() === ""
                ? {}
                : { description: description.trim() }),
              initialAgentParticipantIds: selectedAgentIds,
              name: name.trim(),
              slug,
              visibility,
            })
              .then(() => setActionError(undefined))
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          {archivedCollision === undefined ? null : (
            <section className="rah-room-create-archived-warning" role="status">
              <p>
                名称 <b>#{archivedCollision.name}</b> 已被一个已归档的频道占用。
              </p>
              <small>
                {canUnarchive
                  ? "取消归档可保留其历史记录，或者改用其他名称。"
                  : "请改用其他名称，或请管理员取消归档。"}
              </small>
              <div>
                {canUnarchive ? (
                  <button
                    className="btn btn-green"
                    disabled={pending}
                    onClick={() => {
                      setPending(true);
                      void onUnarchive(archivedCollision)
                        .catch((caught) => setActionError(errorMessage(caught)))
                        .finally(() => setPending(false));
                    }}
                    type="button"
                  >
                    {pending ? "正在取消归档…" : "取消归档"}
                  </button>
                ) : null}
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => {
                    setArchivedCollision(undefined);
                    setName("");
                    requestAnimationFrame(() => nameInputRef.current?.focus());
                  }}
                  type="button"
                >
                  修改名称
                </button>
              </div>
            </section>
          )}
          <label>
            <span>
              名称 <em>*</em>
            </span>
            <input
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                setArchivedCollision(undefined);
              }}
              placeholder="例如 ai-research"
              data-dialog-initial-focus
              ref={nameInputRef}
              required
              value={name}
            />
          </label>
          <label>
            <span>
              描述 <small>可选</small>
            </span>
            <textarea
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="这个频道是做什么的？"
              rows={2}
              value={description}
            />
          </label>
          <fieldset className="rah-room-visibility">
            <legend>可见性</legend>
            <div>
              <button
                aria-checked={visibility === "public"}
                className={visibility === "public" ? "is-selected" : ""}
                onClick={() => setVisibility("public")}
                role="radio"
                type="button"
              >
                <Icon name="hash" /> 公开
              </button>
              <button
                aria-checked={visibility === "private"}
                className={visibility === "private" ? "is-selected" : ""}
                onClick={() => setVisibility("private")}
                role="radio"
                type="button"
              >
                <Icon name="lock" /> 私密
              </button>
            </div>
          </fieldset>
          <section className="rah-room-create-members">
            <h3>
              成员 <small>可选</small>
            </h3>
            <div className="rah-room-create-member-search">
              <Icon name="search" />
              <input
                aria-label="搜索成员"
                onChange={(event) => setMemberSearch(event.target.value)}
                placeholder="按名称搜索成员"
                type="search"
                value={memberSearch}
              />
            </div>
            <div className="rah-room-create-agent-list rah-scroll-main">
              <h4>AGENT</h4>
              {visibleAgents.length === 0 ? (
                <p>没有匹配的 Agent。</p>
              ) : (
                visibleAgents.map((agent) => {
                  const selected = selectedAgentIds.includes(
                    agent.participantId,
                  );
                  return (
                    <button
                      aria-pressed={selected}
                      className={selected ? "is-selected" : ""}
                      key={agent.participantId}
                      onClick={() =>
                        setSelectedAgentIds((current) =>
                          current.includes(agent.participantId)
                            ? current.filter(
                                (participantId) =>
                                  participantId !== agent.participantId,
                              )
                            : [...current, agent.participantId],
                        )
                      }
                      type="button"
                    >
                      <AgentAvatar
                        agent={agent}
                        size="sidebar"
                        showStatus={false}
                      />
                      <span>
                        <b>{agent.displayName}</b>
                      </span>
                      {selected ? <Icon name="check" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </section>
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="btn btn-pink" disabled={pending || !valid}>
              {pending ? "正在创建…" : "创建频道"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function RoomMembersDialog({
  canAdd: allowedAdd,
  canDelete,
  canLeave,
  canManageRoles: allowedRoles,
  canRemove: allowedRemove,
  canStopAgents,
  canUpdate,
  candidates,
  members,
  memberships = [],
  onAdd,
  onArchive,
  onClose: onClosed,
  renderProfile,
  onHideAll,
  onDelete,
  onLeave,
  onRemove,
  onResumeAgents,
  onRole,
  onStopAgents,
  onUnarchive,
  onUpdate,
  room,
}: {
  canAdd: boolean;
  canDelete: boolean;
  canLeave: boolean;
  canManageRoles: boolean;
  canRemove: boolean;
  canStopAgents: boolean;
  canUpdate: boolean;
  candidates: readonly ReturnType<typeof roomAgentCandidates>[number][];
  members: readonly Principal[];
  memberships?: readonly RoomMembership[];
  onAdd: (agent: AgentMembershipIdentity) => Promise<void>;
  onArchive: () => Promise<void>;
  onClose: () => void;
  onHideAll?: () => Promise<void>;
  renderProfile?: (
    target: { kind: "agent" | "human"; id: string },
    onBack: () => void,
    onClose: () => void,
  ) => ReactNode;
  onDelete: () => Promise<void>;
  onLeave: () => Promise<void>;
  onRemove: (agent: AgentMembershipIdentity) => Promise<void>;
  onResumeAgents: (guidance: string) => Promise<void>;
  onRole: (principalId: string, role: RoomMembership["role"]) => Promise<void>;
  onStopAgents: () => Promise<void>;
  onUnarchive: () => Promise<void>;
  onUpdate: (input: {
    description?: string;
    name: string;
    visibility: "private" | "public";
  }) => Promise<void>;
  room: Room | undefined;
  leaveUnavailableReason?: string | undefined;
}) {
  const { closing, close: onClose } = useOverlayDrawerMotion(onClosed);
  const [profile, setProfile] = useState<{
    kind: "agent" | "human";
    id: string;
  }>();
  const fixedMembership = room?.kind === "channel" && room.slug === "all";
  const canAdd = allowedAdd && !fixedMembership;
  const canRemove = allowedRemove && !fixedMembership;
  const canManageRoles = allowedRoles && !fixedMembership;
  const [pendingAgentId, setPendingAgentId] = useState<string>();
  const [removeTarget, setRemoveTarget] = useState<
    AgentMembershipIdentity & { displayName?: string }
  >();
  const sidebarPreferences = useSidebarPreferences();
  const [settingsPending, setSettingsPending] = useState(false);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [visibilityConfirm, setVisibilityConfirm] = useState<
    "public" | "private"
  >();
  const visibilityTriggerRef = useRef<HTMLButtonElement>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const archiveTriggerRef = useRef<HTMLButtonElement>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const leaveTriggerRef = useRef<HTMLButtonElement>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [sosPhase, setSosPhase] = useState<"confirm" | "stopped">("confirm");
  const [sosGuidance, setSosGuidance] = useState("");
  const [sosStopping, setSosStopping] = useState(false);
  const [sosResuming, setSosResuming] = useState(false);
  const sosTriggerRef = useRef<HTMLButtonElement>(null);
  const [actionError, setActionError] = useState<string>();
  const [description, setDescription] = useState(room?.description ?? "");
  const [view, setView] = useState<"settings" | "members" | "add">("settings");
  const addOrigin = useRef<"settings" | "members">("settings");
  const focusReturn = useRef<string | undefined>(undefined);
  const [name, setName] = useState(room?.name ?? "");
  const [visibility, setVisibility] = useState<"private" | "public">(
    room?.visibility ?? "private",
  );
  const mutationPendingRef = useRef(false);
  const mutationBlocked =
    pendingAgentId !== undefined ||
    settingsPending ||
    lifecyclePending ||
    sosStopping ||
    sosResuming;
  const roomArchived = room?.archivedAt !== undefined;
  const dialogRef = useDialogProtocol({
    blocked: mutationBlocked,
    initialFocus: "container",
    onClose: () =>
      profile
        ? setProfile(undefined)
        : view === "settings"
          ? onClose()
          : back(),
  });
  useEffect(() => {
    setDescription(room?.description ?? "");
    setName(room?.name ?? "");
    setVisibility(room?.visibility ?? "private");
  }, [room?.description, room?.name, room?.roomId, room?.visibility]);
  const entities = useWorkspaceEntities();
  const humans = members
    .filter(({ kind }) => kind === "human")
    .map((person) => ({ ...person, ...entities?.resolvePerson(person) }));
  const joinedAgents = candidates.filter(({ joined }) => joined);
  const settingsDirty =
    name.trim() !== (room?.name ?? "") ||
    description.trim() !== (room?.description ?? "") ||
    visibility !== (room?.visibility ?? "private");
  const valid = name.trim().length > 0;
  useEffect(() => {
    if (focusReturn.current) {
      dialogRef.current
        ?.querySelector<HTMLButtonElement>(
          `button[aria-label="${focusReturn.current}"]`,
        )
        ?.focus();
      focusReturn.current = undefined;
    }
  }, [view, dialogRef]);
  const openAdd = () => {
    if (mutationPendingRef.current || !canAdd) return;
    addOrigin.current = view === "members" ? "members" : "settings";
    setActionError(undefined);
    setView("add");
  };
  const back = () => {
    if (mutationPendingRef.current) return;
    focusReturn.current = view === "add" ? "添加成员" : "管理成员";
    setActionError(undefined);
    setView(view === "add" ? addOrigin.current : "settings");
  };
  const addSelection = async (
    agents: ReturnType<typeof roomAgentCandidates>,
  ) => {
    if (mutationPendingRef.current || !canAdd)
      return agents.map((a) => a.participantId);
    mutationPendingRef.current = true;
    const failed: string[] = [];
    const errors: string[] = [];
    setActionError(undefined);
    try {
      for (const agent of agents) {
        setPendingAgentId(agent.participantId);
        try {
          await onAdd(agent);
        } catch (caught) {
          failed.push(agent.participantId);
          errors.push(`${agent.displayName}: ${errorMessage(caught)}`);
        }
      }
      if (failed.length)
        setActionError(`部分成员未添加，请重试失败项。${errors.join("；")}`);
      else {
        focusReturn.current = "添加成员";
        setView(addOrigin.current);
      }
      return failed;
    } finally {
      mutationPendingRef.current = false;
      setPendingAgentId(undefined);
    }
  };
  const remove = (agent: AgentMembershipIdentity) => {
    if (mutationPendingRef.current || !canRemove) return;
    mutationPendingRef.current = true;
    setPendingAgentId(agent.participantId);
    void onRemove(agent)
      .then(() => {
        setActionError(undefined);
        setRemoveTarget(undefined);
      })
      .catch((caught) => setActionError(errorMessage(caught)))
      .finally(() => {
        mutationPendingRef.current = false;
        setPendingAgentId(undefined);
      });
  };
  const setRole = async (principalId: string, role: RoomMembership["role"]) => {
    if (mutationPendingRef.current || !canManageRoles) return;
    mutationPendingRef.current = true;
    setPendingAgentId(principalId);
    setActionError(undefined);
    try {
      await onRole(principalId, role);
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    } finally {
      mutationPendingRef.current = false;
      setPendingAgentId(undefined);
    }
  };
  const saveSettings = () => {
    if (
      mutationPendingRef.current ||
      !canUpdate ||
      roomArchived ||
      !valid ||
      !settingsDirty
    )
      return;
    mutationPendingRef.current = true;
    setSettingsPending(true);
    void onUpdate({
      ...(description.trim() === "" ? {} : { description: description.trim() }),
      name: name.trim(),
      visibility,
    })
      .then(() => setActionError(undefined))
      .catch((caught) => setActionError(errorMessage(caught)))
      .finally(() => {
        mutationPendingRef.current = false;
        setSettingsPending(false);
      });
  };
  const changeArchiveState = async (archive: boolean) => {
    if (mutationPendingRef.current || !canUpdate) return;
    mutationPendingRef.current = true;
    setLifecyclePending(true);
    setActionError(undefined);
    try {
      await (archive ? onArchive() : onUnarchive());
      setArchiveConfirmOpen(false);
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    } finally {
      mutationPendingRef.current = false;
      setLifecyclePending(false);
    }
  };
  const closeArchiveConfirmation = () => {
    setArchiveConfirmOpen(false);
    requestAnimationFrame(() => archiveTriggerRef.current?.focus());
  };
  const leave = async () => {
    if (mutationPendingRef.current || !canLeave) return;
    mutationPendingRef.current = true;
    setLifecyclePending(true);
    setActionError(undefined);
    try {
      await onLeave();
      setLeaveConfirmOpen(false);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      mutationPendingRef.current = false;
      setLifecyclePending(false);
    }
  };
  const closeLeaveConfirmation = () => {
    setLeaveConfirmOpen(false);
    requestAnimationFrame(() => leaveTriggerRef.current?.focus());
  };
  const deleteRoom = async () => {
    if (mutationPendingRef.current || !canDelete) return;
    mutationPendingRef.current = true;
    setLifecyclePending(true);
    setDeleteError(undefined);
    try {
      await onDelete();
      setDeleteConfirmOpen(false);
    } catch (caught) {
      setDeleteError(errorMessage(caught));
    } finally {
      mutationPendingRef.current = false;
      setLifecyclePending(false);
    }
  };
  const closeDeleteConfirmation = () => {
    if (lifecyclePending) return;
    setDeleteConfirmOpen(false);
    setDeleteError(undefined);
    requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  };
  const closeSos = () => {
    if (sosStopping || sosResuming) return;
    setSosOpen(false);
    setSosPhase("confirm");
    setSosGuidance("");
    requestAnimationFrame(() => sosTriggerRef.current?.focus());
  };
  const stopAgents = async () => {
    if (sosStopping || sosResuming || !canStopAgents) return;
    setSosStopping(true);
    setActionError(undefined);
    try {
      await onStopAgents();
      setSosPhase("stopped");
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    } finally {
      setSosStopping(false);
    }
  };
  const resumeAgents = async () => {
    const guidance = sosGuidance.trim();
    if (sosStopping || sosResuming || guidance.length === 0) return;
    setSosResuming(true);
    setActionError(undefined);
    try {
      await onResumeAgents(guidance);
      setSosOpen(false);
      setSosPhase("confirm");
      setSosGuidance("");
      requestAnimationFrame(() => sosTriggerRef.current?.focus());
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    } finally {
      setSosResuming(false);
    }
  };
  return (
    <div
      className="rah-channel-settings-layer"
      data-closing={closing || undefined}
      role="presentation"
    >
      <button
        aria-label="关闭频道详情与设置"
        className="rah-channel-settings-backdrop"
        disabled={mutationBlocked}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-room-members-title"
        aria-modal="true"
        className="rah-channel-settings-drawer"
        data-room-members-view={view}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {!profile && view === "settings" && (
          <ChannelSettingsHeader
            name={room?.name ?? "Room"}
            description={description}
            visibility={visibility}
            blocked={mutationBlocked}
            onClose={onClose}
          />
        )}
        {actionError === undefined ? null : (
          <p className="rah-dialog-error" role="alert">
            {actionError}
          </p>
        )}
        {profile && renderProfile ? (
          renderProfile(profile, () => setProfile(undefined), onClose)
        ) : view !== "settings" ? (
          <RoomMemberPage
            key={view}
            view={view}
            backLabel={
              view === "add" && addOrigin.current === "members"
                ? "返回成员管理"
                : "返回频道设置"
            }
            blocked={mutationBlocked}
            canAdd={canAdd}
            fixedMembership={fixedMembership}
            canManageRoles={canManageRoles}
            canRemove={canRemove}
            candidates={candidates}
            humans={humans}
            memberships={memberships}
            onBack={back}
            onOpenProfile={setProfile}
            onOpenAdd={openAdd}
            onAddSelection={addSelection}
            onRemove={(agent) => {
              if (!mutationPendingRef.current && canRemove) {
                setActionError(undefined);
                setRemoveTarget(agent);
              }
            }}
            onRole={setRole}
          />
        ) : (
          <div className="rah-channel-settings-scroll rah-scroll-main">
            <section className="rah-channel-settings-members">
              <header>
                <button
                  aria-label="管理成员"
                  disabled={mutationBlocked}
                  onClick={() => setView("members")}
                >
                  <span>成员</span>
                  <span>
                    {humans.length} 位人类 · {joinedAgents.length} 个 Agent{" "}
                    <Icon name="chevron-right" />
                  </span>
                </button>
              </header>
              <div className="rah-channel-member-avatars">
                {humans.map((member) => (
                  <button
                    onClick={() => setView("members")}
                    aria-label={`管理成员：${member.displayName || member.handle}`}
                    className="rah-channel-human-avatar"
                    key={member.principalId}
                    title={member.displayName || member.handle}
                  >
                    <ProfileImageAvatar
                      avatarKey={member.avatarKey}
                      name={member.displayName || member.handle}
                      size="compact"
                    />
                  </button>
                ))}
                {joinedAgents.map((agent) => (
                  <button
                    className="rah-channel-avatar-trigger"
                    key={agent.participantId}
                    aria-label={`管理成员：${agent.displayName}`}
                    onClick={() => setView("members")}
                  >
                    <AgentAvatar agent={agent} size="header" />
                  </button>
                ))}
                {!fixedMembership && (
                  <button
                    aria-label="添加成员"
                    className="rah-channel-member-add"
                    disabled={!canAdd || mutationBlocked}
                    onClick={openAdd}
                    title="添加成员"
                  >
                    +
                  </button>
                )}
              </div>
            </section>
            <div className="rah-channel-settings-info">
              <header>
                <h3>信息</h3>
                <p>在整个工作空间中显示的名称和描述。</p>
              </header>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveSettings();
                }}
              >
                <div className="rah-channel-settings-field">
                  <label htmlFor="rah-channel-name">
                    名称 <em>*</em>
                  </label>
                  <input
                    disabled={
                      room?.slug === "all" ||
                      !canUpdate ||
                      roomArchived ||
                      mutationBlocked
                    }
                    id="rah-channel-name"
                    onChange={(event) => setName(event.target.value)}
                    placeholder="例如 ai-research"
                    required
                    value={name}
                  />
                </div>
                <div className="rah-channel-settings-field rah-channel-settings-description-field">
                  <label htmlFor="rah-channel-description">
                    描述
                    <span className="rah-channel-settings-optional">可选</span>
                  </label>
                  <textarea
                    disabled={!canUpdate || roomArchived || mutationBlocked}
                    id="rah-channel-description"
                    maxLength={2000}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="这个频道是做什么的？"
                    rows={3}
                    value={description}
                  />
                </div>
                <footer>
                  <button
                    className="btn"
                    disabled={mutationBlocked || !settingsDirty}
                    onClick={() => {
                      setDescription(room?.description ?? "");
                      setName(room?.name ?? "");
                      setVisibility(room?.visibility ?? "private");
                    }}
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    className="btn btn-pink"
                    disabled={
                      !canUpdate ||
                      roomArchived ||
                      mutationBlocked ||
                      !valid ||
                      !settingsDirty
                    }
                  >
                    {settingsPending ? "正在保存…" : "保存更改"}
                  </button>
                </footer>
              </form>
              <section className="rah-channel-settings-preferences">
                <h3>偏好</h3>
                <label>
                  <span>
                    <b>置顶频道</b>
                    <small>将此频道固定在你的侧栏顶部。</small>
                  </span>
                  <input
                    aria-label="置顶频道"
                    type="checkbox"
                    disabled={
                      !room ||
                      !sidebarPreferences?.data ||
                      sidebarPreferences.pending
                    }
                    checked={
                      sidebarPreferences?.data?.preferences.pinned.includes(
                        `room:${room?.roomId}`,
                      ) ?? false
                    }
                    onChange={(event) => {
                      if (!room || !sidebarPreferences?.data) return;
                      const key = `room:${room.roomId}`,
                        pinned = sidebarPreferences.data.preferences.pinned;
                      void sidebarPreferences.patch({
                        pinned: event.target.checked
                          ? [...pinned, key]
                          : pinned.filter((id) => id !== key),
                      });
                    }}
                  />
                  <i aria-hidden="true" />
                </label>
                {sidebarPreferences?.error && (
                  <p role="alert">{sidebarPreferences.error}</p>
                )}
                <label>
                  <span>
                    <b>静音活动</b>
                    <small>静音此频道的普通活动，只影响你。</small>
                  </span>
                  <input
                    aria-label="静音活动"
                    checked={
                      room && sidebarPreferences?.data
                        ? roomActivityMuted(
                            sidebarPreferences.data.preferences.mutedActivity,
                            room.roomId,
                          )
                        : false
                    }
                    disabled={
                      !room ||
                      !sidebarPreferences?.data ||
                      sidebarPreferences.pending
                    }
                    onChange={(event) => {
                      if (!room || !sidebarPreferences?.data) return;
                      void sidebarPreferences.patch({
                        mutedActivity: setRoomPreference(
                          sidebarPreferences.data.preferences.mutedActivity,
                          room.roomId,
                          event.target.checked,
                        ),
                      });
                    }}
                    type="checkbox"
                  />
                  <i aria-hidden="true" />
                </label>
                <label>
                  <span>
                    <b>折叠长消息</b>
                    <small>
                      超过预览高度的消息折叠在「显示更多」开关后。关闭后此频道的长消息始终完整显示。
                    </small>
                  </span>
                  <input
                    aria-label="折叠长消息"
                    checked={
                      room && sidebarPreferences?.data
                        ? roomLongMessagesCollapsed(
                            sidebarPreferences.data.preferences
                              .expandedLongMessages,
                            room.roomId,
                          )
                        : true
                    }
                    disabled={
                      !room ||
                      !sidebarPreferences?.data ||
                      sidebarPreferences.pending
                    }
                    onChange={(event) => {
                      if (!room || !sidebarPreferences?.data) return;
                      void sidebarPreferences.patch({
                        expandedLongMessages: setRoomPreference(
                          sidebarPreferences.data.preferences
                            .expandedLongMessages,
                          room.roomId,
                          !event.target.checked,
                        ),
                      });
                    }}
                    type="checkbox"
                  />
                  <i aria-hidden="true" />
                </label>
              </section>
              <section className="rah-channel-settings-operations">
                <h3>操作</h3>
                {fixedMembership && onHideAll && (
                  <HideAllChannelAction
                    disabled={!canUpdate || mutationBlocked}
                    onHide={onHideAll}
                  />
                )}
                {room?.slug !== "all" && (
                  <>
                    <button
                      className="btn rah-channel-visibility-button"
                      ref={visibilityTriggerRef}
                      disabled={!canUpdate || roomArchived || mutationBlocked}
                      onClick={() => {
                        setActionError(undefined);
                        setVisibilityConfirm(
                          room?.visibility === "public" ? "private" : "public",
                        );
                      }}
                      type="button"
                    >
                      <Icon
                        name={room?.visibility === "public" ? "lock" : "hash"}
                      />
                      {room?.visibility === "public" ? "设为私密" : "设为公开"}
                    </button>
                    {roomArchived ? (
                      <button
                        className="btn"
                        disabled={!canUpdate || mutationBlocked}
                        onClick={() => void changeArchiveState(false)}
                        type="button"
                      >
                        {lifecyclePending ? "正在恢复…" : "取消归档频道"}
                      </button>
                    ) : (
                      <button
                        className="btn btn-orange rah-channel-archive-button"
                        disabled={!canUpdate || mutationBlocked}
                        onClick={() => setArchiveConfirmOpen(true)}
                        ref={archiveTriggerRef}
                        type="button"
                      >
                        <Icon name="archive" />
                        归档频道
                      </button>
                    )}
                    {!roomArchived ? (
                      <>
                        <button
                          className="btn btn-orange rah-channel-leave-button"
                          disabled={!canLeave || mutationBlocked}
                          onClick={() => setLeaveConfirmOpen(true)}
                          ref={leaveTriggerRef}
                          type="button"
                        >
                          <Icon name="log-out" />
                          退出频道
                        </button>
                      </>
                    ) : null}
                  </>
                )}
                {!roomArchived ? (
                  <button
                    className="btn btn-orange rah-channel-sos-button"
                    disabled={!canStopAgents || mutationBlocked}
                    onClick={() => {
                      setSosPhase("confirm");
                      setSosGuidance("");
                      setSosOpen(true);
                    }}
                    ref={sosTriggerRef}
                    type="button"
                  >
                    <Icon name="circle-stop" />
                    停止 Agent
                  </button>
                ) : null}
                {room?.slug !== "all" && (
                  <button
                    className="btn rah-channel-delete-button"
                    disabled={!canDelete || mutationBlocked}
                    onClick={() => {
                      setDeleteError(undefined);
                      setDeleteConfirmOpen(true);
                    }}
                    ref={deleteTriggerRef}
                    type="button"
                  >
                    <Icon name="trash-2" />
                    删除频道
                  </button>
                )}
              </section>
            </div>
          </div>
        )}
      </section>
      {removeTarget && (
        <RoomMemberRemoveConfirmation
          name={removeTarget.displayName ?? removeTarget.handle}
          roomName={room?.name ?? ""}
          blocked={pendingAgentId !== undefined}
          error={actionError}
          onCancel={() => {
            if (!mutationPendingRef.current) setRemoveTarget(undefined);
          }}
          onConfirm={() => remove(removeTarget)}
        />
      )}
      {visibilityConfirm ? (
        <RoomVisibilityConfirmation
          blocked={settingsPending}
          error={actionError}
          name={room?.name ?? ""}
          visibility={visibilityConfirm}
          onCancel={() => {
            if (mutationPendingRef.current) return;
            setVisibilityConfirm(undefined);
            visibilityTriggerRef.current?.focus();
          }}
          onConfirm={async () => {
            if (
              mutationPendingRef.current ||
              !room ||
              !canUpdate ||
              roomArchived
            )
              return;
            mutationPendingRef.current = true;
            setSettingsPending(true);
            setActionError(undefined);
            try {
              await onUpdate({
                name: room.name,
                ...(room.description === undefined
                  ? {}
                  : { description: room.description }),
                visibility: visibilityConfirm,
              });
              setVisibilityConfirm(undefined);
              visibilityTriggerRef.current?.focus();
            } catch (error) {
              setActionError(String(error));
            } finally {
              mutationPendingRef.current = false;
              setSettingsPending(false);
            }
          }}
        />
      ) : null}
      {archiveConfirmOpen ? (
        <RoomArchiveConfirmation
          blocked={lifecyclePending}
          name={room?.name ?? "Room"}
          onCancel={closeArchiveConfirmation}
          onConfirm={() => changeArchiveState(true)}
        />
      ) : null}
      {leaveConfirmOpen ? (
        <RoomLeaveConfirmation
          blocked={lifecyclePending}
          error={actionError}
          name={room?.name ?? "Room"}
          onCancel={closeLeaveConfirmation}
          onConfirm={leave}
        />
      ) : null}
      {deleteConfirmOpen ? (
        <RoomDeleteConfirmation
          blocked={lifecyclePending}
          {...(deleteError === undefined ? {} : { error: deleteError })}
          name={room?.name ?? "Room"}
          onCancel={closeDeleteConfirmation}
          onConfirm={deleteRoom}
        />
      ) : null}
      {sosOpen ? (
        <RoomAgentSosDialog
          {...(actionError === undefined ? {} : { error: actionError })}
          guidance={sosGuidance}
          phase={sosPhase}
          resuming={sosResuming}
          roomName={room?.name ?? "Room"}
          stopping={sosStopping}
          onClose={closeSos}
          onGuidance={setSosGuidance}
          onResume={resumeAgents}
          onStop={stopAgents}
        />
      ) : null}
    </div>
  );
}

function RoomAgentSosDialog({
  error,
  guidance,
  onClose,
  onGuidance,
  onResume,
  onStop,
  phase,
  resuming,
  roomName,
  stopping,
}: {
  error?: string;
  guidance: string;
  onClose: () => void;
  onGuidance: (guidance: string) => void;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  phase: "confirm" | "stopped";
  resuming: boolean;
  roomName: string;
  stopping: boolean;
}) {
  const blocked = stopping || resuming;
  const dialogRef = useDialogProtocol({ blocked, onClose });
  return (
    <div className="rah-dialog-layer rah-room-sos-dialog" role="presentation">
      <div aria-hidden="true" className="rah-dialog-backdrop" />
      <section
        aria-labelledby="rah-room-sos-title"
        aria-modal="true"
        className="rah-dialog rah-channel-confirmation"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-room-sos-title">
            {phase === "confirm" ? "停止所有 Agent" : "Agent 已停止"}
          </h2>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={blocked}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        {error === undefined ? null : (
          <p className="rah-dialog-error" role="alert">
            {error}
          </p>
        )}
        {phase === "confirm" ? (
          <>
            <p>
              #{roomName} 中所有正在运行的 Agent
              都会立即停止。恢复前，你可以提供新的指导。
            </p>
            <footer>
              <button className="btn" disabled={blocked} onClick={onClose}>
                取消
              </button>
              <button
                autoFocus
                className="btn btn-orange rah-channel-sos-button"
                data-dialog-initial-focus
                disabled={blocked}
                onClick={() => void onStop()}
              >
                {stopping ? "停止中…" : "停止"}
              </button>
            </footer>
          </>
        ) : (
          <>
            <p className="rah-room-sos-success" role="status">
              所有 Agent 均已停止。
            </p>
            <p>提供纠正和新的指导后再恢复全部 Agent。</p>
            <textarea
              aria-label="恢复 Agent 的纠正指导"
              autoFocus
              data-dialog-initial-focus
              disabled={blocked}
              maxLength={4000}
              onChange={(event) => onGuidance(event.target.value)}
              placeholder="说明哪里需要纠正，以及接下来应如何继续…"
              rows={4}
              value={guidance}
            />
            <footer>
              <button className="btn" disabled={blocked} onClick={onClose}>
                保持停止
              </button>
              <button
                className="btn rah-room-sos-resume-button"
                disabled={blocked || guidance.trim().length === 0}
                onClick={() => void onResume()}
              >
                {resuming ? "正在恢复…" : "全部恢复"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function RoomArchiveConfirmation({
  blocked,
  name,
  onCancel,
  onConfirm,
}: {
  blocked: boolean;
  name: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialogRef = useDialogProtocol({ blocked, onClose: onCancel });
  return (
    <div
      className="rah-dialog-layer rah-room-archive-confirm"
      role="presentation"
    >
      <div aria-hidden="true" className="rah-dialog-backdrop" />
      <section
        aria-labelledby="rah-room-archive-title"
        aria-modal="true"
        className="rah-dialog rah-channel-confirmation"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-room-archive-title">归档频道</h2>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={blocked}
            onClick={onCancel}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>
          成员仍可阅读「{name}
          」及其历史记录，但将无法发送新消息，且该频道会从侧栏中隐藏。你之后可以取消归档。
        </p>
        <footer>
          <button className="btn" disabled={blocked} onClick={onCancel}>
            取消
          </button>
          <button
            autoFocus
            className="btn btn-orange rah-channel-archive-button"
            data-dialog-initial-focus
            disabled={blocked}
            onClick={() => void onConfirm()}
          >
            {blocked ? "正在归档…" : "归档"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function RoomLeaveConfirmation({
  blocked,
  error,
  name,
  onCancel,
  onConfirm,
}: {
  blocked: boolean;
  error: string | undefined;
  name: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialogRef = useDialogProtocol({ blocked, onClose: onCancel });
  return (
    <div
      className="rah-dialog-layer rah-room-leave-confirm"
      role="presentation"
    >
      <div aria-hidden="true" className="rah-dialog-backdrop" />
      <section
        aria-labelledby="rah-room-leave-title"
        aria-modal="true"
        className="rah-dialog rah-channel-confirmation"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-room-leave-title">退出频道</h2>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={blocked}
            onClick={onCancel}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>
          你将停止接收 #{name}
          的常规消息，并且在重新加入前无法发送消息。RAH OS 当前按 Room
          成员资格统一保护历史与消息列；离开后这些内容也会从本地导航中移除，直到管理员重新加入你。
        </p>
        {error === undefined ? null : (
          <p className="rah-dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="btn" disabled={blocked} onClick={onCancel}>
            取消
          </button>
          <button
            autoFocus
            className="btn btn-orange rah-channel-leave-button"
            data-dialog-initial-focus
            disabled={blocked}
            onClick={() => void onConfirm()}
          >
            {blocked ? "正在退出…" : "离开"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function RoomDeleteConfirmation({
  blocked,
  error,
  name,
  onCancel,
  onConfirm,
}: {
  blocked: boolean;
  error?: string;
  name: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialogRef = useDialogProtocol({ blocked, onClose: onCancel });
  return (
    <div
      className="rah-dialog-layer rah-room-delete-confirm"
      role="presentation"
    >
      <div aria-hidden="true" className="rah-dialog-backdrop" />
      <section
        aria-labelledby="rah-room-delete-title"
        aria-modal="true"
        className="rah-dialog rah-channel-confirmation"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-room-delete-title">删除频道</h2>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={blocked}
            onClick={onCancel}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>「{name}」及其中的所有消息都会被永久删除，且无法撤销。</p>
        {error === undefined ? null : (
          <p className="rah-dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="btn" disabled={blocked} onClick={onCancel}>
            取消
          </button>
          <button
            autoFocus
            className="btn rah-channel-delete-button"
            data-dialog-initial-focus
            disabled={blocked}
            onClick={() => void onConfirm()}
          >
            {blocked ? "删除中…" : "永久删除"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RAH OS request failed";
}
