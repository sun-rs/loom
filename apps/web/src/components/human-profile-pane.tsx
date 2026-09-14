import type { RahClient } from "@rah-os/client-sdk";
import type { MembershipRole } from "@rah-os/protocol";
import { useEffect, useRef, useState } from "react";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { AgentEntityCard } from "./agent-entity-card.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import {
  useHumanIdentity,
  useWorkspaceEntities,
} from "./workspace-entity-context.tsx";
import { useHumanProfile } from "../human-profile-hooks.ts";
import { HumanProfileFields } from "./human-profile-fields.tsx";
import { RolePermissionsHelp } from "./agent-role-permissions.tsx";
import {
  roomMemberRoleLabel,
  roomMemberRoleOptions,
} from "../room-member-role.ts";

export function HumanProfilePane({
  client,
  principalId,
  workspaceId,
  onBack,
  backLabel,
  onClose,
  canChangeRole,
  onChangeRole,
  onOpenAgent,
}: {
  client: RahClient;
  principalId: string;
  workspaceId: string | undefined;
  onBack: () => void;
  backLabel?: string | undefined;
  onClose?: (() => void) | undefined;
  canChangeRole: boolean;
  onChangeRole: (principalId: string, role: MembershipRole) => Promise<void>;
  onOpenAgent: (id: string) => void;
}) {
  const entities = useWorkspaceEntities();
  const context = useHumanIdentity();
  const [opening, setOpening] = useState(false);
  const [directError, setDirectError] = useState<string>();
  const [roleEditing, setRoleEditing] = useState(false);
  const [rolePending, setRolePending] = useState(false);
  const [roleError, setRoleError] = useState<string>();
  const [selectedRole, setSelectedRole] = useState<MembershipRole>("member");
  const roleTrigger = useRef<HTMLButtonElement>(null);
  const roleSelect = useRef<HTMLSelectElement>(null);
  const restoreRoleFocus = useRef(false);
  const actorId = entities?.scope?.actorId;
  const { profile, error, refresh } = useHumanProfile(
    client,
    principalId,
    workspaceId,
  );
  // Only render a successfully authorized profile. A URL or directory candidate
  // is not evidence of membership, and a failed lookup is not an empty profile.
  const observedHuman = profile?.principal;
  const human = observedHuman
    ? { ...observedHuman, ...entities?.resolvePerson(observedHuman) }
    : undefined;
  const name = human?.displayName || human?.handle || "成员资料";
  const ownerCount =
    entities?.humans().filter(({ membership }) => membership.role === "owner")
      .length ?? 0;
  const roleEditable = Boolean(
    human &&
    human.principalId !== actorId &&
    canChangeRole &&
    (profile?.membership.role !== "owner" || ownerCount > 1),
  );
  useEffect(() => {
    if (!roleEditable) setRoleEditing(false);
    if (!roleEditing && roleEditable && restoreRoleFocus.current) {
      roleTrigger.current?.focus();
      restoreRoleFocus.current = false;
    }
  }, [roleEditable, roleEditing]);
  useEffect(() => {
    if (roleEditing) roleSelect.current?.focus();
  }, [roleEditing]);
  useEffect(() => {
    setRoleEditing(false);
    setRoleError(undefined);
  }, [principalId, workspaceId]);
  const closeRoleEditor = () => {
    restoreRoleFocus.current = true;
    setSelectedRole(profile?.membership.role ?? "member");
    setRoleError(undefined);
    setRoleEditing(false);
  };
  return (
    <section className="rah-agent-detail-panel" aria-label="Human 详情">
      <PanelHeader kind="surface" className="rah-agent-detail-head">
        <PanelHeaderAction
          className="rah-agent-mobile-back"
          aria-label={backLabel ?? "返回成员列表"}
          onClick={onBack}
        >
          <Icon name="arrow-left" />
        </PanelHeaderAction>
        {human && (
          <ProfileImageAvatar
            avatarKey={human.avatarKey}
            name={name}
            principalId={human.principalId}
          />
        )}
        <div className="rah-agent-detail-identity">
          <h2>{name}</h2>
          {human && <p>@{human.displayName || human.handle}</p>}
        </div>
        {human && human.principalId !== actorId && context && (
          <PanelHeaderAction
            aria-label="发送私信"
            disabled={opening}
            onClick={() => {
              setOpening(true);
              setDirectError(undefined);
              void context
                .onOpenDirect(human.principalId)
                .catch((cause: unknown) =>
                  setDirectError(
                    cause instanceof Error ? cause.message : "打开私信失败",
                  ),
                )
                .finally(() => setOpening(false));
            }}
          >
            <Icon name="chat" />
          </PanelHeaderAction>
        )}
        {onClose && (
          <PanelHeaderAction aria-label="关闭 Human 侧栏" onClick={onClose}>
            <Icon name="x" />
          </PanelHeaderAction>
        )}
      </PanelHeader>
      <div className="rah-profile-body">
        {error ? (
          <div className="rah-profile-notice" role="alert">
            <p>无法读取成员资料：{error}</p>
            <button className="btn" type="button" onClick={refresh}>
              重试
            </button>
          </div>
        ) : !profile || !human ? (
          <p className="rah-profile-notice" role="status">
            正在读取成员资料…
          </p>
        ) : (
          <>
            <HumanProfileFields key={human.principalId} human={human} />
            {directError && (
              <p className="rah-profile-notice" role="alert">
                {directError}
              </p>
            )}
            <ProfileSection title="信息">
              <dl className="rah-profile-fields">
                <div>
                  <dt>
                    角色 <RolePermissionsHelp subject="human" />
                    {roleEditable && !roleEditing ? (
                      <button
                        aria-label="编辑角色"
                        className="rah-profile-edit rah-interaction-flat"
                        onClick={() => {
                          setSelectedRole(profile.membership.role);
                          setRoleError(undefined);
                          setRoleEditing(true);
                        }}
                        ref={roleTrigger}
                        title="编辑角色"
                        type="button"
                      >
                        <Icon name="pencil" />
                      </button>
                    ) : null}
                  </dt>
                  <dd>
                    {roleEditing && roleEditable ? (
                      <form
                        className="rah-profile-role-editor"
                        onKeyDown={(event) => {
                          if (event.key !== "Escape" || rolePending) return;
                          event.preventDefault();
                          closeRoleEditor();
                        }}
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (
                            !human ||
                            !roleEditable ||
                            rolePending ||
                            selectedRole === profile.membership.role
                          )
                            return;
                          setRolePending(true);
                          setRoleError(undefined);
                          void onChangeRole(human.principalId, selectedRole)
                            .then(() => {
                              closeRoleEditor();
                              refresh();
                            })
                            .catch((cause: unknown) =>
                              setRoleError(
                                cause instanceof Error
                                  ? cause.message
                                  : "更新角色失败",
                              ),
                            )
                            .finally(() => setRolePending(false));
                        }}
                      >
                        <select
                          aria-label={`${name} 的角色`}
                          disabled={rolePending}
                          onChange={(event) =>
                            setSelectedRole(
                              event.target.value as MembershipRole,
                            )
                          }
                          ref={roleSelect}
                          value={selectedRole}
                        >
                          {roomMemberRoleOptions("human").map((role) => (
                            <option key={role} value={role}>
                              {roomMemberRoleLabel(role)}
                            </option>
                          ))}
                        </select>
                        <div className="rah-profile-role-actions">
                          <button
                            className="btn btn-pink"
                            disabled={
                              rolePending ||
                              selectedRole === profile.membership.role
                            }
                          >
                            {rolePending ? "保存中…" : "保存"}
                          </button>
                          <button
                            className="btn"
                            disabled={rolePending}
                            onClick={closeRoleEditor}
                            type="button"
                          >
                            取消
                          </button>
                        </div>
                        {roleError ? <p role="alert">{roleError}</p> : null}
                      </form>
                    ) : (
                      <span
                        className="rah-profile-role"
                        data-role={profile.membership.role}
                      >
                        {roomMemberRoleLabel(profile.membership.role)}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>加入时间</dt>
                  <dd>
                    {new Intl.DateTimeFormat("zh-CN", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }).format(new Date(profile.membership.joinedAt))}
                  </dd>
                </div>
              </dl>
            </ProfileSection>
            <ProfileSection
              title="已创建的 AGENT"
              count={
                profile.canReadCreatedAgents
                  ? profile.createdAgentDefinitionIds.length
                  : undefined
              }
            >
              {!profile.canReadCreatedAgents ? (
                <p className="rah-profile-empty">
                  当前权限不能查看 Agent 创建关系。
                </p>
              ) : profile.createdAgents.length ? (
                <div className="rah-profile-cards">
                  {profile.createdAgents.map((agent) => (
                    <AgentEntityCard
                      key={agent.agentDefinitionId}
                      agent={agent}
                      runtimeLabel={entities
                        ?.runtimesForAgent(agent.agentDefinitionId)
                        .map((runtime) => runtime.displayName)
                        .join(" · ")}
                      onOpen={onOpenAgent}
                    />
                  ))}
                </div>
              ) : (
                <p className="rah-profile-empty">
                  {profile.createdAgentDefinitionIds.length
                    ? "正在读取 Agent 目录…"
                    : "暂无已创建的 Agent"}
                </p>
              )}
              {profile.truncated && (
                <p className="rah-profile-empty">仅显示前 500 个 Agent。</p>
              )}
            </ProfileSection>
          </>
        )}
      </div>
    </section>
  );
}
