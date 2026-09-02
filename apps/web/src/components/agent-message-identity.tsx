import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientAgentGetResponse,
  LocalRuntimeInventoryEntry,
  MessageReferenceReadState,
  RuntimeTrajectoryRecord,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { PreviewCard } from "./preview-card.tsx";
import { AgentAvatar } from "./agent-directory-pane.tsx";
import { AgentStatusDot } from "./agent-status-dot.tsx";
import {
  previewActivityText,
  previewActivityKind,
} from "../agent-preview-presentation.ts";
import {
  agentConnectionLabel,
  agentPresencePresentation,
} from "../attention-presentation.ts";

export const AgentMessageContext = createContext<
  | {
      client: RahClient;
      runtimes: readonly LocalRuntimeInventoryEntry[];
      computerLabel: string | undefined;
      onOpen: (id: string) => void;
    }
  | undefined
>(undefined);

export function MessageAgentAvatar({ agent }: { agent: WorkspaceAgentView }) {
  const context = useContext(AgentMessageContext);
  return (
    <PreviewCard
      label={`查看 ${agent.displayName} 动态`}
      triggerClassName="rah-message-avatar-trigger"
      className="rah-agent-preview"
      onClick={() => context?.onOpen(agent.agentDefinitionId)}
      content={
        context ? (
          <AgentPreview
            agent={agent}
            client={context.client}
            runtimes={context.runtimes}
            computerLabel={context.computerLabel}
          />
        ) : null
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
        context ? (
          <AgentPreview
            agent={agent}
            client={context.client}
            runtimes={context.runtimes}
            computerLabel={context.computerLabel}
          />
        ) : null
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
  runtimes,
  computerLabel,
}: {
  agent: WorkspaceAgentView;
  client: RahClient;
  runtimes: readonly LocalRuntimeInventoryEntry[];
  computerLabel: string | undefined;
}) {
  const [detail, setDetail] = useState<ClientAgentGetResponse>();
  const [activities, setActivities] = useState<RuntimeTrajectoryRecord[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setDetail(undefined);
    setActivities([]);
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
    void client
      .request(
        "agent.trajectory.list",
        { agentDefinitionId: agent.agentDefinitionId, limit: 5 },
        { signal: controller.signal },
      )
      .then((a) => {
        if (!controller.signal.aborted) {
          setActivities(a.activities);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, agent.agentDefinitionId]);
  const runtime = runtimes.find((r) =>
    r.agentBindings.some(
      (b) => b.agentDefinitionId === agent.agentDefinitionId,
    ),
  );
  const bindingId = detail?.policy.modelIntent.exactBindingIds?.[0];
  const model = runtime?.modelBindingDescriptors.find(
    (m) => m.modelBindingId === bindingId,
  );
  const modelLabel = profileLoading
    ? "加载中…"
    : profileError
      ? "暂时无法读取"
      : (model?.displayName ?? model?.modelId ?? bindingId ?? "Runtime 默认");
  const reasoning = detail?.policy.modelIntent.reasoning;
  return (
    <>
      <div className="rah-agent-preview-identity">
        <AgentAvatar agent={agent} size="profile" />
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
            <dd title={computerLabel}>{computerLabel ?? "未绑定"}</dd>
            <dt>运行时</dt>
            <dd title={runtime?.displayName}>
              {runtime?.displayName ?? "未绑定"}
            </dd>
            <dt>模型</dt>
            <dd title={modelLabel}>{modelLabel}</dd>
            {reasoning ? (
              <>
                <dt>推理强度</dt>
                <dd title={reasoning}>
                  {reasoning === "default" ? "默认" : reasoning}
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
      <section>
        <h4>最近动态</h4>
        {loading ? (
          <p>正在读取动态…</p>
        ) : error ? (
          <p>暂时无法读取动态</p>
        ) : activities.length === 0 ? (
          <p>暂无已记录动态</p>
        ) : (
          activities
            .toSorted((a, b) => a.serverSequence - b.serverSequence)
            .slice(-5)
            .map((a) => (
              <div className="rah-preview-event" key={a.serverSequence}>
                <time>
                  {new Date(a.observedAt).toLocaleTimeString([], {
                    hour12: false,
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
    </>
  );
}
