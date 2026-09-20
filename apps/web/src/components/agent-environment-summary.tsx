import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";

/** Read only the current Agent/runtime overlay; Host remains its persistence owner. */
export function AgentEnvironmentSummary({
  client,
  agentId,
  runtimeId,
  refresh,
}: {
  client: RahClient;
  agentId: string;
  runtimeId: string | undefined;
  refresh: number;
}) {
  const [result, setResult] = useState<{
    identity: string;
    keys: string[];
    error?: string;
  }>();
  const identity = `${agentId}:${runtimeId}`;
  useEffect(() => {
    if (!runtimeId) return;
    const controller = new AbortController();
    client
      .request("runtime.guide.read", { agentId }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({
            identity,
            keys: Object.keys(
              data.runtimes.find((row) => row.runtimeId === runtimeId)
                ?.environment ?? {},
            ),
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ identity, keys: [], error: "无法读取环境变量" });
      });
    return () => controller.abort();
  }, [client, agentId, runtimeId, refresh, identity]);
  if (!runtimeId || result?.identity !== identity) return null;
  if (result.error) return <p role="alert">{result.error}</p>;
  if (!result.keys.length) return null;
  return (
    <div className="rah-agent-environment-summary">
      <span>环境变量</span>
      <div>
        {result.keys.map((key) => (
          <span key={key}>
            {key}=<i>••••••••</i>
          </span>
        ))}
      </div>
    </div>
  );
}
