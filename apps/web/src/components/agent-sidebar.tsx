import { LoadingState } from "@rah-os/ui-web/neo-brutalist/loading-state";
import {
  MemberContextActions,
  type MemberContextControl,
} from "./member-context-actions.tsx";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceHumanMember } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { PanelHeaderIcon } from "@rah-os/ui-web/neo-brutalist/panel-header-icon";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { computerStatusLabel } from "../attention-presentation.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";

export function AgentSidebar({
  agents,
  contextControl,
  canCreate,
  computerLabel,
  computerStatus,
  currentHumanId,
  humans,
  humanDirectoryError,
  humanDirectoryLoading,
  humansTruncated,
  onRetryHumans,
  onSelectHuman,
  selectedHumanId,
  onCreate,
  onRelationship,
  onSelect,
  onOpenDirectRoom,
  relationshipSelected,
  selectedAgentDefinitionId,
}: {
  agents: readonly WorkspaceAgentView[];
  contextControl: MemberContextControl;
  canCreate: boolean;
  computerLabel: string | undefined;
  computerStatus?: WorkspaceAgentView["connectionStatus"];
  currentHumanId: string | undefined;
  humans: readonly WorkspaceHumanMember[];
  humanDirectoryError?: string | undefined;
  humanDirectoryLoading?: boolean | undefined;
  humansTruncated?: boolean | undefined;
  onRetryHumans?: (() => void) | undefined;
  onSelectHuman: (principalId: string) => void;
  selectedHumanId: string | undefined;
  onCreate: () => void;
  onRelationship: () => void;
  onSelect: (agentId: string) => void;
  onOpenDirectRoom?: ((principalId: string) => Promise<void>) | undefined;
  relationshipSelected: boolean;
  selectedAgentDefinitionId: string | undefined;
}) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [directError, setDirectError] = useState<string>();
  const openingDirect = useRef(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canCreate) setCreateMenuOpen(false);
  }, [canCreate]);

  useEffect(() => {
    if (!createMenuOpen) return;
    const closeOutside = (event: globalThis.PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !createMenuRef.current?.contains(event.target)
      ) {
        setCreateMenuOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setCreateMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [createMenuOpen]);

  return (
    <aside className="rah-agent-directory-list" aria-label="Agent 列表">
      <PanelHeader
        kind="sidebar"
        className="rah-agent-sidebar-head rah-mobile-root-header"
      >
        <PanelHeaderIcon name="members" className="rah-mobile-only" />
        <h1>成员</h1>
      </PanelHeader>
      <div className="rah-agent-sidebar-scroll rah-scroll-main">
        {directError ? <p role="alert">{directError}</p> : null}
        <button
          aria-current={relationshipSelected ? "page" : undefined}
          className={`rah-agent-relationship rah-interaction-row${relationshipSelected ? " is-selected" : ""}`}
          onClick={onRelationship}
          type="button"
        >
          <Icon name="git-branch" />
          <span>关系图</span>
        </button>
        <section className="rah-agent-sidebar-section">
          <header>
            <Icon name="chevron" />
            <b>AGENT</b>
            <span>{agents.length}</span>
            <div className="rah-agent-create-control" ref={createMenuRef}>
              <button
                aria-expanded={canCreate && createMenuOpen}
                aria-haspopup="menu"
                aria-label="添加 Agent"
                className="rah-interaction-flat"
                disabled={!canCreate}
                onClick={() => setCreateMenuOpen((current) => !current)}
                title={
                  canCreate ? "添加 Agent" : "当前 Workspace 不允许创建 Role"
                }
              >
                +
              </button>
              {canCreate && createMenuOpen ? (
                <div className="rah-agent-create-menu" role="menu">
                  <button
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onCreate();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="bot" />
                    创建 Role
                  </button>
                  <button
                    disabled
                    role="menuitem"
                    title="外部 Agent 激活协议尚未接入"
                    type="button"
                  >
                    <Icon name="link-2" />
                    创建外部 Agent
                  </button>
                </div>
              ) : null}
            </div>
          </header>
          {computerLabel === undefined ? null : (
            <p className="rah-agent-computer-label">
              <i
                data-online={computerStatus === "online"}
                title={computerStatusLabel(
                  computerStatus ? { status: computerStatus } : undefined,
                )}
              />
              {computerLabel}
            </p>
          )}
          {agents.map((agent) => (
            <MemberContextActions
              key={agent.agentId}
              agent={agent}
              principalId={agent.participantId}
              control={contextControl}
            >
              <button
                aria-current={
                  agent.agentId === selectedAgentDefinitionId
                    ? "page"
                    : undefined
                }
                className={`rah-agent-member-row rah-interaction-row${agent.agentId === selectedAgentDefinitionId ? " is-selected" : ""}`}
                key={agent.agentId}
                onClick={(event) => {
                  if (event.detail < 2) onSelect(agent.agentId);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  if (!onOpenDirectRoom || openingDirect.current) return;
                  openingDirect.current = true;
                  setDirectError(undefined);
                  void onOpenDirectRoom(agent.participantId)
                    .catch((error) =>
                      setDirectError(
                        error instanceof Error ? error.message : "无法打开私信",
                      ),
                    )
                    .finally(() => {
                      openingDirect.current = false;
                    });
                }}
              >
                <AgentAvatar agent={agent} size="sidebar" />
                <span>
                  <b>{agent.displayName}</b>
                  <small>
                    {agent.description}
                    {agent.state === "disabled" ? " · 已暂停" : null}
                  </small>
                </span>
              </button>
            </MemberContextActions>
          ))}
        </section>
        <section className="rah-agent-sidebar-section rah-agent-human-section">
          <header>
            <Icon name="chevron" />
            <b>人类</b>
            <span>
              {humanDirectoryLoading && !humans.length
                ? "…"
                : `${humans.length}${humansTruncated ? "+" : ""}`}
            </span>
          </header>
          {humanDirectoryError ? (
            <div className="rah-profile-notice" role="alert">
              <p>无法读取成员列表：{humanDirectoryError}</p>
              <button className="btn" type="button" onClick={onRetryHumans}>
                重试成员列表
              </button>
            </div>
          ) : humanDirectoryLoading && !humans.length ? (
            <LoadingState />
          ) : humans.length === 0 ? (
            <p className="rah-profile-notice">暂无可访问的人类成员</p>
          ) : null}
          {humansTruncated ? (
            <p className="rah-profile-notice">仅显示前 500 位成员。</p>
          ) : null}
          {humans.map(({ principal: human }) => (
            <MemberContextActions
              key={human.principalId}
              principalId={human.principalId}
              self={human.principalId === currentHumanId}
              control={contextControl}
            >
              <button
                key={human.principalId}
                type="button"
                className={`rah-agent-member-row rah-interaction-row${selectedHumanId === human.principalId ? " is-selected" : ""}`}
                aria-current={
                  selectedHumanId === human.principalId ? "page" : undefined
                }
                onClick={() => onSelectHuman(human.principalId)}
              >
                <ProfileImageAvatar
                  avatarKey={human.avatarKey}
                  name={human.displayName || human.handle}
                  principalId={human.principalId}
                  size="sidebar"
                />
                <span>
                  <b>
                    {human.displayName || human.handle}
                    {human.principalId === currentHumanId ? (
                      <span className="rah-member-self">（你）</span>
                    ) : null}
                  </b>
                </span>
              </button>
            </MemberContextActions>
          ))}
        </section>
      </div>
    </aside>
  );
}
