import { useEffect, useRef, useState } from "react";
import type { Principal, RoomMembership } from "@rah-os/protocol";
import type { roomAgentCandidates } from "@rah-os/ui-web";
import { AgentAvatar } from "./agent-directory-pane.tsx";
import { agentPresencePresentation } from "../attention-presentation.ts";
import type { AgentMembershipIdentity } from "./room-dialogs.tsx";
import "../room-member-pages.css";

type Candidate = ReturnType<typeof roomAgentCandidates>[number];

/** Raft Nst member/add layouts. The containing drawer owns navigation and the
 * mutation fence; this page owns only search, disclosure and selection. */
export function RoomMemberPage({
  view,
  backLabel,
  blocked,
  canAdd,
  canRemove,
  candidates,
  humans,
  memberships,
  onBack,
  onOpenAdd,
  onAddSelection,
  onRemove,
}: {
  view: "members" | "add";
  backLabel: string;
  blocked: boolean;
  canAdd: boolean;
  canRemove: boolean;
  candidates: readonly Candidate[];
  humans: readonly Principal[];
  memberships: readonly RoomMembership[];
  onBack: () => void;
  onOpenAdd: () => void;
  onAddSelection: (agents: Candidate[]) => Promise<string[]>;
  onRemove: (agent: AgentMembershipIdentity) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const query = search.trim().toLocaleLowerCase();
  const matches = (...values: (string | undefined)[]) =>
    values.some((value) => value?.toLocaleLowerCase().includes(query));
  const agents = candidates.filter((a) =>
    view === "add" ? !a.joined : a.joined,
  );
  const visibleAgents = agents.filter((a) =>
    matches(a.displayName, a.handle, a.description),
  );
  const selectedAgents = agents.filter(
    (a) => selected.includes(a.participantId) && a.state === "enabled",
  );
  const roleBadge = (principalId: string) => {
    const role =
      memberships.find((m) => m.principalId === principalId)?.role ?? "member";
    return (
      <span className={`rah-room-member-role is-${role}`}>
        {role === "owner" ? "所有者" : role === "admin" ? "管理员" : "成员"}
      </span>
    );
  };
  return (
    <>
      <header className="rah-room-member-page-header">
        <button
          aria-label={backLabel}
          className="btn"
          disabled={blocked}
          onClick={onBack}
        >
          ←
        </button>
        <h2 id="rah-room-members-title">
          {view === "add" ? "添加成员" : "成员"}
        </h2>
        {view === "members" && (
          <span className="rah-room-member-count">
            {humans.length + agents.length}
          </span>
        )}
      </header>
      <div className={`rah-room-member-page rah-scroll-main is-${view}`}>
        <div className="rah-room-member-search">
          {view === "add" && (
            <label htmlFor="rah-room-member-query">搜索</label>
          )}
          <div>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="10" cy="10" r="7" />
              <path d="m15 15 6 6" />
            </svg>
            <input
              aria-label={view === "add" ? "名称" : "搜索成员"}
              id="rah-room-member-query"
              disabled={blocked}
              ref={inputRef}
              placeholder={view === "add" ? "名称" : "搜索成员…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {view === "add" ? (
          <>
            <section className="rah-room-add-candidates">
              <h3>Agent</h3>
              {visibleAgents.length === 0 && (
                <p className="rah-members-empty">
                  {agents.length
                    ? "没有匹配的 Agent。"
                    : "没有其他可添加的 Agent。"}
                </p>
              )}
              {visibleAgents.map((agent) => (
                <button
                  key={agent.participantId}
                  className="rah-room-add-candidate"
                  aria-label={`选择 ${agent.displayName}`}
                  aria-pressed={selected.includes(agent.participantId)}
                  disabled={blocked || !canAdd || agent.state !== "enabled"}
                  onClick={() =>
                    setSelected((ids) =>
                      ids.includes(agent.participantId)
                        ? ids.filter((id) => id !== agent.participantId)
                        : [...ids, agent.participantId],
                    )
                  }
                >
                  <span className="rah-room-member-checkbox" aria-hidden="true">
                    {selected.includes(agent.participantId) ? "✓" : ""}
                  </span>
                  <AgentAvatar agent={agent} size="compact" />
                  <span>
                    <b>{agent.displayName}</b>
                    {agent.description && <small>{agent.description}</small>}
                    {agent.state !== "enabled" && <small>Agent 已停用</small>}
                  </span>
                </button>
              ))}
            </section>
            <button
              className="btn btn-pink rah-room-add-submit"
              disabled={blocked || !canAdd || selectedAgents.length === 0}
              onClick={() => {
                void onAddSelection(selectedAgents).then(setSelected);
              }}
            >
              {blocked ? "正在添加…" : `添加所选（${selectedAgents.length}）`}
            </button>
          </>
        ) : (
          <>
            <details className="rah-room-member-group" open>
              <summary>人类 · {humans.length}</summary>
              {humans
                .filter((h) => matches(h.handle))
                .map((human) => (
                  <div
                    className="rah-room-member-entry"
                    key={human.principalId}
                  >
                    <span className="rah-channel-human-avatar">
                      {human.handle.slice(0, 1).toUpperCase()}
                    </span>
                    <b>{human.handle}</b>
                    {roleBadge(human.principalId)}
                  </div>
                ))}
            </details>
            <details className="rah-room-member-group" open>
              <summary>Agent · {agents.length}</summary>
              {visibleAgents.map((agent) => (
                <div
                  className="rah-room-member-entry rah-member-row"
                  key={agent.participantId}
                >
                  <AgentAvatar agent={agent} size="member" />
                  <span>
                    <b>{agent.displayName}</b>
                    <small>{agentPresencePresentation(agent).label}</small>
                  </span>
                  {roleBadge(agent.participantId)}
                  {canRemove && (
                    <button
                      className="rah-room-member-remove"
                      aria-label={`移出 ${agent.displayName}`}
                      disabled={blocked}
                      onClick={() => onRemove(agent)}
                    >
                      移出
                    </button>
                  )}
                </div>
              ))}
              {visibleAgents.length === 0 && (
                <p className="rah-members-empty">
                  {agents.length
                    ? "没有匹配的 Agent。"
                    : "当前频道尚未添加 Agent。"}
                </p>
              )}
            </details>
            <button
              className="btn rah-room-members-add"
              aria-label="添加成员"
              disabled={!canAdd || blocked}
              onClick={onOpenAdd}
            >
              ＋ 添加成员
            </button>
          </>
        )}
      </div>
    </>
  );
}
