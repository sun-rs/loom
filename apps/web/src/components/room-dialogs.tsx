import { useRef, useState } from "react";

import type { Principal, Room, Workspace } from "@rah-os/protocol";
import {
  roomAgentCandidates,
  roomSlugFromName,
  type WorkspaceAgentView,
} from "@rah-os/ui-web";

import { useDialogProtocol } from "../dialog-protocol.ts";

export type AgentMembershipIdentity = Pick<
  WorkspaceAgentView,
  "agentDefinitionId" | "handle" | "participantId"
>;

export function RoomCreateDialog({
  onClose,
  onCreate,
  workspace,
}: {
  onClose: () => void;
  onCreate: (input: { name: string; slug: string }) => Promise<void>;
  workspace: Workspace | undefined;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const valid = name.trim().length > 0 && slug.trim().length > 0;
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
        className="rah-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-room-create-title">新建频道</h2>
            <p>{workspace?.name ?? "Workspace"}</p>
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
            void onCreate({ name: name.trim(), slug: slug.trim() })
              .then(() => setActionError(undefined))
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <label>
            频道名称
            <input
              autoFocus
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!slugEdited) setSlug(roomSlugFromName(nextName));
              }}
              placeholder="Agent Council"
              value={name}
            />
          </label>
          <label>
            Slug
            <input
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(roomSlugFromName(event.target.value));
              }}
              placeholder="agent-council"
              value={slug}
            />
          </label>
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
  candidates,
  members,
  onAdd,
  onClose,
  onRemove,
  room,
}: {
  canAdd: boolean;
  canRemove: boolean;
  candidates: readonly ReturnType<typeof roomAgentCandidates>[number][];
  members: readonly Principal[];
  onAdd: (agent: AgentMembershipIdentity) => Promise<void>;
  onClose: () => void;
  onRemove: (agent: AgentMembershipIdentity) => Promise<void>;
  room: Room | undefined;
}) {
  const [pendingAgentId, setPendingAgentId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const mutationPendingRef = useRef(false);
  const mutationBlocked = pendingAgentId !== undefined;
  const dialogRef = useDialogProtocol({
    blocked: mutationBlocked,
    onClose,
  });
  const humans = members.filter(({ kind }) => kind === "human");
  const joinedAgents = candidates.filter(({ joined }) => joined);
  const availableAgents = candidates.filter(({ joined }) => !joined);
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
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭 Room 成员窗口"
        className="rah-dialog-backdrop"
        disabled={pendingAgentId !== undefined}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-room-members-title"
        aria-modal="true"
        className="rah-dialog rah-members-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-room-members-title">#{room?.name ?? "Room"} 成员</h2>
            <p>
              {humans.length + joinedAgents.length} 位成员 · membership
              决定消息投递
            </p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pendingAgentId !== undefined}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        {actionError === undefined ? null : (
          <p className="rah-dialog-error">{actionError}</p>
        )}
        <div className="rah-members-scroll">
          <h3>当前 Human</h3>
          {humans.length === 0 ? (
            <p className="rah-members-empty">没有可见 Human。</p>
          ) : (
            humans.map((member) => (
              <div className="rah-member-row" key={member.principalId}>
                <span className="rah-runtime-icon">
                  {member.handle.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <b>{member.handle}</b>
                  <span>Human · {member.principalId}</span>
                </div>
                <span className="rah-runtime-state is-online">成员</span>
              </div>
            ))
          )}
          <h3>当前 Agents</h3>
          {joinedAgents.length === 0 ? (
            <p className="rah-members-empty">当前 Room 尚未添加 Agent。</p>
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
          <h3>添加 Workspace Agent</h3>
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
