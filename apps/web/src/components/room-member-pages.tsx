import { ChoiceRow } from "@rah-os/ui-web/neo-brutalist/choice-row";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { useEffect, useRef, useState } from "react";
import type {
  MembershipRole,
  Principal,
  RoomMembership,
} from "@rah-os/protocol";
import type { roomAgentCandidates } from "@rah-os/ui-web";
import { AgentAvatar } from "./agent-directory-pane.tsx";
import { agentPresencePresentation } from "../attention-presentation.ts";
import type { AgentMembershipIdentity } from "./room-dialogs.tsx";
import {
  roomMemberRoleLabel,
  roomMemberRoleOptions,
} from "../room-member-role.ts";
import "../room-member-pages.css";

type Candidate = ReturnType<typeof roomAgentCandidates>[number];

/** Raft Nst member/add layouts. The containing drawer owns navigation and the
 * mutation fence; this page owns only search, disclosure and selection. */
export function RoomMemberPage({
  view,
  backLabel,
  blocked,
  canAdd,
  fixedMembership = false,
  canManageRoles,
  canRemove,
  candidates,
  humans,
  memberships,
  onBack,
  onOpenProfile,
  onOpenAdd,
  onAddSelection,
  onRemove,
  onRole,
}: {
  view: "members" | "add";
  backLabel: string;
  blocked: boolean;
  canAdd: boolean;
  fixedMembership?: boolean;
  canManageRoles: boolean;
  canRemove: boolean;
  candidates: readonly Candidate[];
  humans: readonly Principal[];
  memberships: readonly RoomMembership[];
  onBack: () => void;
  onOpenProfile?: (target: { kind: "agent" | "human"; id: string }) => void;
  onOpenAdd: () => void;
  onAddSelection: (agents: Candidate[]) => Promise<string[]>;
  onRemove: (agent: AgentMembershipIdentity) => void;
  onRole: (principalId: string, role: MembershipRole) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [roleEditor, setRoleEditor] = useState<{
    currentRole: MembershipRole;
    handle: string;
    principalId: string;
    selectedRole: MembershipRole;
  }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const roleSelectRef = useRef<HTMLSelectElement>(null);
  const roleTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    roleSelectRef.current?.focus();
  }, [roleEditor?.principalId]);
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
  const roleBadge = (
    principalId: string,
    options?: { editable?: boolean; handle?: string },
  ) => {
    const role =
      memberships.find((m) => m.principalId === principalId)?.role ?? "member";
    if (role === "member") return null;
    if (options?.editable && options.handle) {
      return (
        <button
          aria-label={`编辑 ${options.handle} 的角色`}
          className={`rah-room-member-role is-${role} is-editable`}
          disabled={blocked}
          onClick={(event) => {
            event.stopPropagation();
            roleTriggerRef.current = event.currentTarget;
            setRoleEditor({
              currentRole: role,
              handle: options.handle!,
              principalId,
              selectedRole: role,
            });
          }}
          type="button"
        >
          频道管理员
        </button>
      );
    }
    return (
      <span className={`rah-room-member-role is-${role}`}>频道管理员</span>
    );
  };
  const closeRoleEditor = () => {
    setRoleEditor(undefined);
    queueMicrotask(() => roleTriggerRef.current?.focus());
  };
  return (
    <>
      <header className="rah-room-member-page-header">
        <PanelHeaderAction
          aria-label={backLabel}
          disabled={blocked}
          onClick={onBack}
        >
          <Icon name="arrow-left" />
        </PanelHeaderAction>
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
            <Icon name="search" />
            <input
              aria-label="搜索成员"
              id="rah-room-member-query"
              disabled={blocked}
              ref={inputRef}
              placeholder={view === "add" ? "名称" : "搜索成员..."}
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
                <ChoiceRow
                  profile="member-selection"
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
                </ChoiceRow>
              ))}
            </section>
            <button
              className="btn btn-pink rah-room-add-submit"
              disabled={blocked || !canAdd || selectedAgents.length === 0}
              onClick={() => {
                void onAddSelection(selectedAgents).then(setSelected);
              }}
            >
              <Icon name="plus" />
              {blocked ? "正在添加…" : `添加所选（${selectedAgents.length}）`}
            </button>
          </>
        ) : (
          <>
            <div className="rah-room-member-list rah-scroll-main">
              <details className="rah-room-member-group" open>
                <summary>
                  <Icon name="chevron-down" />
                  <span>
                    人类
                    <span className="rah-room-member-group-count">
                      {" "}
                      ·{" "}
                      {
                        humans.filter((h) => matches(h.handle, h.displayName))
                          .length
                      }
                    </span>
                  </span>
                </summary>
                {humans
                  .filter((h) => matches(h.handle, h.displayName))
                  .map((human) => (
                    <div
                      className="rah-room-member-human"
                      key={human.principalId}
                    >
                      <ChoiceRow
                        as="div"
                        profile="member-browse"
                        className="rah-room-member-entry"
                        role="button"
                        tabIndex={0}
                        aria-label={`查看 ${human.displayName || human.handle} 资料`}
                        onClick={() =>
                          onOpenProfile?.({
                            kind: "human",
                            id: human.principalId,
                          })
                        }
                        onKeyDown={(e) => {
                          if (
                            e.target === e.currentTarget &&
                            (e.key === "Enter" || e.key === " ")
                          ) {
                            e.preventDefault();
                            onOpenProfile?.({
                              kind: "human",
                              id: human.principalId,
                            });
                          }
                        }}
                      >
                        <ProfileImageAvatar
                          principalId={human.principalId}
                          avatarKey={human.avatarKey}
                          name={human.displayName || human.handle}
                          size="compact"
                        />
                        <b>{human.displayName || human.handle}</b>
                        {roleBadge(human.principalId, {
                          editable: canManageRoles,
                          handle: human.displayName || human.handle,
                        })}
                      </ChoiceRow>
                      {roleEditor?.principalId === human.principalId ? (
                        <form
                          className="rah-room-member-role-editor"
                          onKeyDown={(event) => {
                            if (event.key !== "Escape" || blocked) return;
                            event.preventDefault();
                            event.stopPropagation();
                            closeRoleEditor();
                          }}
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (
                              blocked ||
                              roleEditor.selectedRole === roleEditor.currentRole
                            )
                              return;
                            void onRole(
                              roleEditor.principalId,
                              roleEditor.selectedRole,
                            )
                              .then(closeRoleEditor)
                              .catch(() => undefined);
                          }}
                        >
                          <label>
                            角色
                            <select
                              aria-label={`${human.displayName || human.handle} 的角色`}
                              disabled={blocked}
                              onChange={(event) =>
                                setRoleEditor((current) =>
                                  current === undefined
                                    ? current
                                    : {
                                        ...current,
                                        selectedRole: event.target
                                          .value as MembershipRole,
                                      },
                                )
                              }
                              ref={roleSelectRef}
                              value={roleEditor.selectedRole}
                            >
                              {roomMemberRoleOptions("human").map((role) => (
                                <option key={role} value={role}>
                                  {roomMemberRoleLabel(role)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div>
                            <button
                              className="btn"
                              disabled={blocked}
                              onClick={closeRoleEditor}
                              type="button"
                            >
                              取消
                            </button>
                            <button
                              aria-label={`保存 ${human.displayName || human.handle} 的角色`}
                              className="btn btn-pink"
                              disabled={
                                blocked ||
                                roleEditor.selectedRole ===
                                  roleEditor.currentRole
                              }
                            >
                              {blocked ? "保存中…" : "保存"}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ))}
              </details>
              <details className="rah-room-member-group" open>
                <summary>
                  <Icon name="chevron-down" />
                  <span>
                    Agent
                    <span className="rah-room-member-group-count">
                      {" "}
                      · {visibleAgents.length}
                    </span>
                  </span>
                </summary>
                {visibleAgents.map((agent) => (
                  <ChoiceRow
                    as="div"
                    profile="member-browse"
                    className="rah-room-member-entry rah-member-row"
                    role="button"
                    tabIndex={0}
                    aria-label={`查看 ${agent.displayName} 资料`}
                    onClick={() =>
                      onOpenProfile?.({
                        kind: "agent",
                        id: agent.agentDefinitionId,
                      })
                    }
                    onKeyDown={(e) => {
                      if (
                        e.target === e.currentTarget &&
                        (e.key === "Enter" || e.key === " ")
                      ) {
                        e.preventDefault();
                        onOpenProfile?.({
                          kind: "agent",
                          id: agent.agentDefinitionId,
                        });
                      }
                    }}
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
                        className="btn rah-room-member-remove"
                        aria-label={`移出 ${agent.displayName}`}
                        disabled={blocked}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(agent);
                        }}
                      >
                        移除
                      </button>
                    )}
                  </ChoiceRow>
                ))}
                {visibleAgents.length === 0 && (
                  <p className="rah-members-empty">
                    {agents.length
                      ? "没有匹配的 Agent。"
                      : "当前频道尚未添加 Agent。"}
                  </p>
                )}
              </details>
            </div>
            {!fixedMembership && (
              <footer className="rah-room-members-footer">
                <button
                  className="btn rah-room-members-add"
                  aria-label="添加成员"
                  disabled={!canAdd || blocked}
                  onClick={onOpenAdd}
                >
                  <Icon name="plus" /> 添加成员
                </button>
              </footer>
            )}
          </>
        )}
      </div>
    </>
  );
}
