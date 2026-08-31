import { createContext, useContext, useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientAgentGetResponse,
  LocalRuntimeInventoryEntry,
  RuntimeTrajectoryRecord,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { PreviewCard } from "./preview-card.tsx";
import { AgentAvatar } from "./agent-directory-pane.tsx";
import { activityPresentation } from "../identity-presentation.ts";
import { agentConnectionLabel } from "../attention-presentation.ts";

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
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void Promise.all([
      client.request(
        "agent.get",
        { agentDefinitionId: agent.agentDefinitionId },
        { signal: controller.signal },
      ),
      client.request(
        "agent.trajectory.list",
        { agentDefinitionId: agent.agentDefinitionId, limit: 5 },
        { signal: controller.signal },
      ),
    ])
      .then(([d, a]) => {
        if (!controller.signal.aborted) {
          setDetail(d);
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
  return (
    <>
      <div className="rah-agent-preview-identity">
        <AgentAvatar agent={agent} size="profile" />
        <div>
          <b>{agent.displayName}</b>
          <small>
            {agentConnectionLabel(agent)} · @{agent.handle}
          </small>
          {agent.description ? <small>{agent.description}</small> : null}
          <dl>
            <dt>计算机</dt>
            <dd>{computerLabel ?? "未绑定"}</dd>
            <dt>运行时</dt>
            <dd>{runtime?.displayName ?? "未绑定"}</dd>
            <dt>模型</dt>
            <dd>
              {model?.displayName ??
                model?.modelId ??
                bindingId ??
                "Runtime 默认"}
            </dd>
          </dl>
        </div>
      </div>
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
                <i
                  data-kind={a.entry.kind}
                  data-activity={
                    a.entry.kind === "status" ? a.entry.activity : undefined
                  }
                />
                <span>
                  {activityPresentation(a.entry).label}{" "}
                  {activityPresentation(a.entry).detail}
                </span>
              </div>
            ))
        )}
      </section>
    </>
  );
}
