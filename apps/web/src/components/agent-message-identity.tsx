import { useContext, useEffect, useState, type ReactNode } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientAgentGetResponse,
  MessageReferenceReadState,
  RuntimeTrajectoryRecord,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { PreviewCard } from "./preview-card.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { AgentStatusDot } from "./agent-status-dot.tsx";
import { runtimeProfilePresentation } from "../agent-runtime-presentation.ts";
import {
  useWorkspaceEntities,
  AgentMessageContext,
} from "./workspace-entity-context.tsx";
import {
  previewActivityText,
  previewActivityKind,
} from "../agent-preview-presentation.ts";
import {
  agentConnectionLabel,
  agentPresencePresentation,
} from "../attention-presentation.ts";
import { formatRahDateTime } from "../date-time-presentation.ts";

export function MessageAgentAvatar({ agent }: { agent: WorkspaceAgentView }) {
  const context = useContext(AgentMessageContext);
  return (
    <PreviewCard
      label={`查看 ${agent.displayName} 动态`}
      triggerClassName="rah-message-avatar-trigger"
      className="rah-agent-preview"
      onClick={() => context?.onOpen(agent.agentDefinitionId)}
      content={
        context ? <AgentPreview agent={agent} client={context.client} /> : null
      }
    >
      <AgentAvatar agent={agent} size="sidebar" />
    </PreviewCard>
  );
}

export function MessageAgentReference({
  agent,
  children,
  readState,
}: {
  agent: WorkspaceAgentView;
  children: ReactNode;
  readState?: MessageReferenceReadState | undefined;
}) {
  const context = useContext(AgentMessageContext);
  return (
    <PreviewCard
      label={`查看 ${agent.displayName} 动态`}
      triggerClassName="rah-rich-agent-reference"
      className="rah-agent-preview"
      onClick={() => context?.onOpen(agent.agentDefinitionId)}
      content={
        context ? <AgentPreview agent={agent} client={context.client} /> : null
      }
    >
      {children}
      {readState === undefined ? null : (
        <span
          aria-hidden="true"
          className="rah-rich-mention-read-dot"
          data-mention-read-state={readState}
        />
      )}
    </PreviewCard>
  );
}

function AgentPreview({
  agent,
  client,
}: {
  agent: WorkspaceAgentView;
  client: RahClient;
}) {
  const entities = useWorkspaceEntities();
  const context = useContext(AgentMessageContext);
  const [detail, setDetail] = useState<ClientAgentGetResponse>();
  const activityScope = JSON.stringify([
    agent.agentDefinitionId,
    entities?.scope?.actorId,
    entities?.scope?.workspaceId,
  ]);
  const [activityRead, setActivityRead] = useState<{
    scope: string;
    client: RahClient;
    activities: RuntimeTrajectoryRecord[];
    error: boolean;
    loading: boolean;
  }>();
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const canReadActivity =
    context?.canManageAgents === true ||
    (detail?.agent.definition.agentDefinitionId === agent.agentDefinitionId &&
      detail?.creator?.kind === "human" &&
      detail.creator.principalId === entities?.scope?.actorId);
  const currentActivity =
    canReadActivity &&
    activityRead?.scope === activityScope &&
    activityRead.client === client
      ? activityRead
      : undefined;
  const activities = currentActivity?.activities ?? [];
  const error = currentActivity?.error ?? false;
  const loading = currentActivity?.loading ?? true;
  useEffect(() => {
    const controller = new AbortController();
    setDetail(undefined);
    setProfileLoading(true);
    setProfileError(false);
    void client
      .request(
        "agent.get",
        { agentDefinitionId: agent.agentDefinitionId },
        { signal: controller.signal },
      )
      .then((d) => {
        if (!controller.signal.aborted) setDetail(d);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProfileError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false);
      });
    return () => controller.abort();
  }, [
    client,
    agent.agentDefinitionId,
    agent.agentDefinitionRevisionId,
    entities?.scope?.actorId,
    entities?.scope?.workspaceId,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    if (!canReadActivity) return () => controller.abort();
    setActivityRead((old) => ({
      scope: activityScope,
      client,
      activities:
        old?.scope === activityScope && old.client === client
          ? old.activities
          : [],
      loading: true,
      error: false,
    }));
    void client
      .request(
        "agent.trajectory.list",
        { agentDefinitionId: agent.agentDefinitionId, limit: 5 },
        { signal: controller.signal },
      )
      .then((a) => {
        if (!controller.signal.aborted) {
          setActivityRead({
            scope: activityScope,
            client,
            activities: a.activities,
            loading: false,
            error: false,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setActivityRead({
            scope: activityScope,
            client,
            activities: [],
            loading: false,
            error: true,
          });
      });
    return () => controller.abort();
  }, [
    client,
    agent.agentDefinitionId,
    canReadActivity,
    entities?.scope?.actorId,
    entities?.scope?.workspaceId,
    activityScope,
    // Reuse canonical presence reconciliation; no independent polling clock.
    // activityAt is not a complete trajectory cursor (documented limitation).
    agent.presence?.activityAt,
  ]);
  const runtimeView = runtimeProfilePresentation(
    entities?.runtimesForAgent(agent.agentDefinitionId) ?? [],
    detail?.policy.modelIntent,
    profileLoading ? "loading" : profileError ? "error" : "ready",
  );
  const boundComputer = entities?.computerForAgent(
    agent.agentDefinitionId,
  )?.displayName;
  return (
    <>
      <div className="rah-agent-preview-identity">
        <AgentAvatar agent={agent} size="preview" showStatus={false} />
        <div>
          <div className="rah-preview-name-line">
            <b>{agent.displayName}</b>
            <AgentStatusDot
              className="rah-preview-presence"
              activity={agentPresencePresentation(agent).activity}
              label={agentConnectionLabel(agent)}
              size="sm"
            />
            <small>{agentConnectionLabel(agent)}</small>
          </div>
          <small>@{agent.handle}</small>
          <dl>
            <dt>计算机</dt>
            <dd title={boundComputer}>{boundComputer ?? "未绑定"}</dd>
            <dt>运行时</dt>
            <dd title={runtimeView.runtimeLabel}>{runtimeView.runtimeLabel}</dd>
            <dt>模型</dt>
            <dd title={runtimeView.modelLabel}>{runtimeView.modelLabel}</dd>
            {runtimeView.reasoningLabel ? (
              <>
                <dt>推理强度</dt>
                <dd title={runtimeView.reasoningLabel}>
                  {runtimeView.reasoningLabel}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>
      {agent.description ? (
        <div
          className="rah-agent-preview-description"
          title={agent.description}
        >
          {agent.description}
        </div>
      ) : null}
      {canReadActivity &&
      (!loading || activities.length > 0) &&
      (error || activities.length > 0) ? (
        <section>
          <h4>最近动态</h4>
          {error ? (
            <p>暂时无法读取动态</p>
          ) : (
            activities
              .toSorted((a, b) => a.serverSequence - b.serverSequence)
              .slice(-5)
              .map((a) => (
                <div className="rah-preview-event" key={a.serverSequence}>
                  <time>
                    {formatRahDateTime(a.observedAt, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                  <AgentStatusDot
                    className="rah-preview-event-dot"
                    activity={previewActivityKind(a.entry)}
                    label={previewActivityText(a.entry)}
                    size="sm"
                  />
                  <span title={previewActivityText(a.entry)}>
                    {previewActivityText(a.entry)}
                  </span>
                </div>
              ))
          )}
        </section>
      ) : null}
    </>
  );
}
