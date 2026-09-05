import type { RahClient } from "@rah-os/client-sdk";
import { useState } from "react";
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

export function HumanProfilePane({
  client,
  principalId,
  workspaceId,
  onBack,
  onOpenAgent,
}: {
  client: RahClient;
  principalId: string;
  workspaceId: string | undefined;
  onBack: () => void;
  onOpenAgent: (id: string) => void;
}) {
  const entities = useWorkspaceEntities();
  const context = useHumanIdentity();
  const [opening, setOpening] = useState(false);
  const [directError, setDirectError] = useState<string>();
  const actorId = entities?.scope?.actorId;
  const { profile, error, refresh } = useHumanProfile(
    client,
    principalId,
    workspaceId,
  );
  // Only render a successfully authorized profile. A URL or directory candidate
  // is not evidence of membership, and a failed lookup is not an empty profile.
  const human = profile?.principal;
  const name = human?.displayName || human?.handle || "成员资料";
  return (
    <section className="rah-agent-detail-panel" aria-label="Human 详情">
      <PanelHeader kind="agent" className="rah-agent-detail-head">
        <PanelHeaderAction
          className="rah-agent-mobile-back"
          aria-label="返回成员列表"
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
          {human && <p>@{human.handle}</p>}
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
                  </dt>
                  <dd>
                    <span
                      className="rah-profile-role"
                      data-role={profile.membership.role}
                    >
                      {
                        { owner: "所有者", admin: "管理员", member: "成员" }[
                          profile.membership.role
                        ]
                      }
                    </span>
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
