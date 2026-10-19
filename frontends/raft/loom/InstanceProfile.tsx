import { useEffect, useState } from "react";
import { Button, Spinner } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientAgentGetResponse,
  LocalRuntimeInventoryResponse,
  RoleListResponse,
  Room,
} from "@rah-os/protocol";
import { ProfileFact } from "./AgentProfileFacts.tsx";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter.ts";
export default function InstanceProfile({
  client,
  instance,
  room,
  stateLabel,
}: {
  client: RahClient;
  instance: RoleListResponse["instances"][number];
  room: Room;
  stateLabel: string;
}) {
  const [data, setData] = useState<{
    profile: ClientAgentGetResponse;
    inventory?: LocalRuntimeInventoryResponse;
  }>();
  const [error, setError] = useState(false),
    [epoch, setEpoch] = useState(0);
  const { formatShortDateTime } = useTimeFormatter();
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError(false);
    void Promise.all([
      client.request(
        "agent.get",
        { agentId: instance.agentId },
        { signal: abort.signal },
      ),
      client
        .request("host.runtime.list", {}, { signal: abort.signal })
        .catch(() => undefined),
    ])
      .then(([profile, inventory]) => {
        if (!abort.signal.aborted) setData({ profile, inventory });
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [client, instance.agentId, instance.roleRevisionId, epoch]);
  if (error)
    return (
      <div role="alert">
        实例资料读取失败。
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEpoch((n) => n + 1)}
        >
          重试
        </Button>
      </div>
    );
  if (!data) return <Spinner aria-label="读取实例资料" />;
  const { agent, policy } = data.profile,
    revision = agent.currentRevision;
  const runtime = data.inventory?.runtimes.find((r) =>
    r.agentBindings.some(
      (b) =>
        b.agentId === instance.agentId &&
        b.participantId === instance.instanceId,
    ),
  );
  const modelId =
    agent.modelBindingId ?? policy.modelIntent.exactBindingIds?.[0];
  const binding = runtime?.modelBindingDescriptors.find(
    (b) => b.modelBindingId === modelId,
  );
  return (
    <dl data-testid="loom-instance-profile" className="space-y-3 px-5 py-5">
      <ProfileFact label="名称">
        {revision.displayName ?? agent.handle}
      </ProfileFact>
      <ProfileFact label="状态">{stateLabel}</ProfileFact>
      <ProfileFact label="当前对话">{room.name}</ProfileFact>
      <ProfileFact label="计算机">
        {runtime ? (data.inventory?.computer?.displayName ?? "未知") : "未知"}
      </ProfileFact>
      <ProfileFact label="CLI">{runtime?.displayName ?? "未知"}</ProfileFact>
      <ProfileFact label="模型">
        {binding?.displayName ?? binding?.modelId ?? modelId ?? "未知"}
      </ProfileFact>
      <ProfileFact label="推理强度">
        {policy.modelIntent.reasoning ?? "未指定"}
      </ProfileFact>
      <ProfileFact label="Role 配置">
        {instance.isCurrent ? "当前修订" : "保留旧配置"}
      </ProfileFact>
      <ProfileFact label="创建时间">
        {formatShortDateTime(agent.definition.createdAt)}
      </ProfileFact>
      <ProfileFact label="角色 Prompt">
        <span className="whitespace-pre-wrap">
          {revision.instructions ?? revision.role}
        </span>
      </ProfileFact>
    </dl>
  );
}
