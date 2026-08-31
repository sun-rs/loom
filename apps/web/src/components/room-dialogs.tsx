import { useEffect, useRef, useState } from "react";

import type { Principal, Room } from "@rah-os/protocol";
import {
  roomAgentCandidates,
  roomSlugFromName,
  type WorkspaceAgentView,
} from "@rah-os/ui-web";

import { useDialogProtocol } from "../dialog-protocol.ts";
import { AgentAvatar } from "./agent-directory-pane.tsx";

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
  const [settingsPending, setSettingsPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [description, setDescription] = useState(room?.description ?? "");
  const [manageMembersOpen, setManageMembersOpen] = useState(false);
  const [name, setName] = useState(room?.name ?? "");
  const [visibility, setVisibility] = useState<"private" | "public">(
    room?.visibility ?? "private",
  );
  const mutationPendingRef = useRef(false);
  const mutationBlocked = pendingAgentId !== undefined || settingsPending;
  const dialogRef = useDialogProtocol({
    blocked: mutationBlocked,
    initialFocus: "container",
    onClose,
  });
  useEffect(() => {
    setDescription(room?.description ?? "");
    setName(room?.name ?? "");
    setVisibility(room?.visibility ?? "private");
  }, [room?.description, room?.name, room?.roomId, room?.visibility]);
  const humans = members.filter(({ kind }) => kind === "human");
  const joinedAgents = candidates.filter(({ joined }) => joined);
  const availableAgents = candidates.filter(({ joined }) => !joined);
  const settingsDirty =
    name.trim() !== (room?.name ?? "") ||
    description.trim() !== (room?.description ?? "") ||
    visibility !== (room?.visibility ?? "private");
  const valid = name.trim().length > 0;
  const mutate = (agent: AgentMembershipIdentity, joined: boolean) => {
    if (mutationPendingRef.current) return;
    mutationPendingRef.current = true;
    setPendingAgentId(agent.participantId);
    void (joined ? onRemove(agent) : onAdd(agent))
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
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="rah-channel-settings-header">
          <span className="rah-visually-hidden">频道详情与设置</span>
          <h2 id="rah-room-members-title">#{room?.name ?? "Room"}</h2>
          <b>{visibility === "private" ? "私密" : "公开"}</b>
          {description === "" ? null : <p>{description}</p>}
        </header>
        {actionError === undefined ? null : (
          <p className="rah-dialog-error">{actionError}</p>
        )}
        <div className="rah-channel-settings-scroll rah-scroll-main">
          <section className="rah-channel-settings-members">
            <header>
              <button onClick={() => setManageMembersOpen((open) => !open)}>
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
                  size="sidebar"
                />
              ))}
              <button
                aria-label="添加成员"
                className="rah-channel-member-add"
                disabled={!canAdd}
                onClick={() => setManageMembersOpen(true)}
                title="添加成员"
              >
                +
              </button>
            </div>
            {manageMembersOpen ? (
              <div className="rah-channel-member-manager">
                <h4>当前 Agents</h4>
                {joinedAgents.length === 0 ? (
                  <p className="rah-members-empty">当前频道尚未添加 Agent。</p>
                ) : (
                  joinedAgents.map((agent) => (
                    <RoomAgentMembershipRow
                      agent={agent}
                      blocked={mutationBlocked}
                      canManage={canRemove}
                      joined
                      key={agent.participantId}
                      onMutate={mutate}
                      pending={pendingAgentId === agent.participantId}
                    />
                  ))
                )}
                <h4>添加 Workspace Agent</h4>
                {availableAgents.length === 0 ? (
                  <p className="rah-members-empty">没有其他可添加的 Agent。</p>
                ) : (
                  availableAgents.map((agent) => (
                    <RoomAgentMembershipRow
                      agent={agent}
                      blocked={mutationBlocked}
                      canManage={canAdd && agent.state === "enabled"}
                      joined={false}
                      key={agent.participantId}
                      onMutate={mutate}
                      pending={pendingAgentId === agent.participantId}
                    />
                  ))
                )}
              </div>
            ) : null}
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
              {[
                ["置顶频道", "将此频道固定在你的侧栏顶部。"],
                ["静音活动", "静音此频道的普通活动，只影响你。"],
                ["折叠长消息", "在此频道中默认折叠长消息。"],
              ].map(([label, detail]) => (
                <label
                  key={label}
                  title="个人频道偏好协议尚未接入，当前不伪造保存"
                >
                  <span>
                    <b>{label}</b>
                    <small>{detail}</small>
                  </span>
                  <input aria-label={label} disabled type="checkbox" />
                  <i aria-hidden="true" />
                </label>
              ))}
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
      </section>
    </div>
  );
}

function RoomAgentMembershipRow({
  agent,
  blocked,
  canManage,
  joined,
  onMutate,
  pending,
}: {
  agent: ReturnType<typeof roomAgentCandidates>[number];
  blocked: boolean;
  canManage: boolean;
  joined: boolean;
  onMutate: (agent: AgentMembershipIdentity, joined: boolean) => void;
  pending: boolean;
}) {
  return (
    <div className="rah-member-row">
      <span className="rah-runtime-icon">
        {agent.handle.slice(0, 1).toUpperCase()}
      </span>
      <div>
        <b>{agent.handle}</b>
        <span>
          {agent.role} ·{" "}
          {agent.runtimeAvailable ? "Runtime 可用" : "Runtime 不可用"}
        </span>
      </div>
      <button
        className={joined ? "btn" : "btn btn-pink"}
        disabled={!canManage || blocked}
        onClick={() => onMutate(agent, joined)}
      >
        {pending ? "处理中…" : joined ? "移出 Room" : "加入 Room"}
      </button>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RAH OS request failed";
}
