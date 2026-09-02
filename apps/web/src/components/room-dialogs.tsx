import { useEffect, useRef, useState } from "react";

import type { Principal, Room, RoomMembership } from "@rah-os/protocol";
import {
  roomAgentCandidates,
  roomSlugFromName,
  type WorkspaceAgentView,
} from "@rah-os/ui-web";

import { useDialogProtocol } from "../dialog-protocol.ts";
import { AgentAvatar } from "./agent-directory-pane.tsx";
import { RoomMemberPage } from "./room-member-pages.tsx";
import { useSidebarPreferences } from "./sidebar-preferences.tsx";
import {
  roomActivityMuted,
  roomAllMessagesNotified,
  roomLongMessagesCollapsed,
  setRoomPreference,
} from "../room-preferences.ts";

export type AgentMembershipIdentity = Pick<
  WorkspaceAgentView,
  "agentDefinitionId" | "handle" | "participantId"
>;

export function RoomCreateDialog({
  agents,
  onClose,
  onCreate,
}: {
  agents: readonly WorkspaceAgentView[];
  onClose: () => void;
  onCreate: (input: {
    description?: string;
    initialAgentParticipantIds: string[];
    name: string;
    slug: string;
    visibility: "private" | "public";
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("public");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
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
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
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
          <label>
            名称 <em>*</em>
            <input
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 ai-research"
              data-dialog-initial-focus
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
              rows={3}
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
                <span>#</span> 公开
              </button>
              <button
                aria-checked={visibility === "private"}
                className={visibility === "private" ? "is-selected" : ""}
                onClick={() => setVisibility("private")}
                role="radio"
                type="button"
              >
                <span>▢</span> 私密
              </button>
            </div>
          </fieldset>
          <section className="rah-room-create-members">
            <h3>
              成员 <small>可选</small>
            </h3>
            <input
              aria-label="搜索成员"
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="按名称搜索成员"
              type="search"
              value={memberSearch}
            />
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
                      <AgentAvatar agent={agent} size="sidebar" />
                      <span>
                        <b>{agent.displayName}</b>
                        {agent.handle === agent.displayName ? null : (
                          <small>@{agent.handle}</small>
                        )}
                      </span>
                      <i>{selected ? "✓" : ""}</i>
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
  canAdd,
  canRemove,
  canUpdate,
  candidates,
  members,
  memberships = [],
  onAdd,
  onClose,
  onRemove,
  onUpdate,
  room,
}: {
  canAdd: boolean;
  canRemove: boolean;
  canUpdate: boolean;
  candidates: readonly ReturnType<typeof roomAgentCandidates>[number][];
  members: readonly Principal[];
  memberships?: readonly RoomMembership[];
  onAdd: (agent: AgentMembershipIdentity) => Promise<void>;
  onClose: () => void;
  onRemove: (agent: AgentMembershipIdentity) => Promise<void>;
  onUpdate: (input: {
    description?: string;
    name: string;
    visibility: "private" | "public";
  }) => Promise<void>;
  room: Room | undefined;
}) {
  const [pendingAgentId, setPendingAgentId] = useState<string>();
  const sidebarPreferences = useSidebarPreferences();
  const [settingsPending, setSettingsPending] = useState(false);
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
  const mutationBlocked = pendingAgentId !== undefined || settingsPending;
  const dialogRef = useDialogProtocol({
    blocked: mutationBlocked,
    initialFocus: "container",
    onClose: () => (view === "settings" ? onClose() : back()),
  });
  useEffect(() => {
    setDescription(room?.description ?? "");
    setName(room?.name ?? "");
    setVisibility(room?.visibility ?? "private");
  }, [room?.description, room?.name, room?.roomId, room?.visibility]);
  const humans = members.filter(({ kind }) => kind === "human");
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
      .then(() => setActionError(undefined))
      .catch((caught) => setActionError(errorMessage(caught)))
      .finally(() => {
        mutationPendingRef.current = false;
        setPendingAgentId(undefined);
      });
  };
  const saveSettings = () => {
    if (mutationPendingRef.current || !canUpdate || !valid || !settingsDirty)
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
  return (
    <div className="rah-channel-settings-layer" role="presentation">
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
        {view === "settings" && (
          <header className="rah-channel-settings-header">
            <span className="rah-visually-hidden">频道详情与设置</span>
            <h2 id="rah-room-members-title">#{room?.name ?? "Room"}</h2>
            <b>{visibility === "private" ? "私密" : "公开"}</b>
            <button
              aria-label="关闭频道设置"
              className="btn rah-room-settings-mobile-close"
              disabled={mutationBlocked}
              onClick={onClose}
            >
              ×
            </button>
            {description === "" ? null : (
              <p className="rah-visually-hidden">{description}</p>
            )}
          </header>
        )}
        {actionError === undefined ? null : (
          <p className="rah-dialog-error" role="alert">
            {actionError}
          </p>
        )}
        {view !== "settings" ? (
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
            canRemove={canRemove}
            candidates={candidates}
            humans={humans}
            memberships={memberships}
            onBack={back}
            onOpenAdd={openAdd}
            onAddSelection={addSelection}
            onRemove={remove}
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
                    {humans.length} 位人类 · {joinedAgents.length} 个 Agent ›
                  </span>
                </button>
              </header>
              <div className="rah-channel-member-avatars">
                {humans.map((member) => (
                  <span
                    aria-label={member.handle}
                    className="rah-channel-human-avatar"
                    key={member.principalId}
                    title={member.handle}
                  >
                    {member.handle.slice(0, 1).toUpperCase()}
                  </span>
                ))}
                {joinedAgents.map((agent) => (
                  <AgentAvatar
                    agent={agent}
                    key={agent.participantId}
                    size="header"
                  />
                ))}
                <button
                  aria-label="添加成员"
                  className="rah-channel-member-add"
                  disabled={!canAdd || mutationBlocked}
                  onClick={openAdd}
                  title="添加成员"
                >
                  +
                </button>
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
                    disabled={!canUpdate || mutationBlocked}
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
                    disabled={!canUpdate || mutationBlocked}
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
                      !canUpdate || mutationBlocked || !valid || !settingsDirty
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
                    <b>通知所有新消息</b>
                    <small>
                      为此频道的普通顶层新消息发送系统通知。精确提及、关注的消息列、输入请求和关键任务状态不依赖此开关。
                    </small>
                  </span>
                  <input
                    aria-label="通知所有新消息"
                    checked={
                      room && sidebarPreferences?.data
                        ? roomAllMessagesNotified(
                            sidebarPreferences.data.preferences
                              .notifyAllMessages,
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
                        notifyAllMessages: setRoomPreference(
                          sidebarPreferences.data.preferences.notifyAllMessages,
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
              <section className="rah-channel-settings-access">
                <header>
                  <h3>频道访问</h3>
                  <p>公开频道会自动对 Workspace Human 可见。</p>
                </header>
                <fieldset>
                  <legend>可见性</legend>
                  <button
                    aria-checked={visibility === "public"}
                    className={visibility === "public" ? "is-selected" : ""}
                    disabled={!canUpdate || mutationBlocked}
                    onClick={() => setVisibility("public")}
                    role="radio"
                    type="button"
                  >
                    # 公开
                  </button>
                  <button
                    aria-checked={visibility === "private"}
                    className={visibility === "private" ? "is-selected" : ""}
                    disabled={!canUpdate || mutationBlocked}
                    onClick={() => setVisibility("private")}
                    role="radio"
                    type="button"
                  >
                    ▢ 私密
                  </button>
                </fieldset>
              </section>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RAH OS request failed";
}
