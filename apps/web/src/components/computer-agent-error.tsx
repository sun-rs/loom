import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
/** Read only the current error observation; never infer errors from message text. */
export function ComputerAgentError({
  client,
  id,
  version,
}: {
  client: RahClient | undefined;
  id: string;
  version: number | undefined;
}) {
  const [detail, setDetail] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    setDetail(undefined);
    if (client)
      void client
        .request(
          "agent.trajectory.list",
          { agentId: id, limit: 100 },
          { signal: c.signal },
        )
        .then((result) => {
          const status = result.activities.find(
            (row) =>
              row.entry.kind === "status" && row.entry.activity === "error",
          );
          if (!c.signal.aborted && status?.entry.kind === "status")
            setDetail(status.entry.detail);
        })
        .catch(() => {});
    return () => c.abort();
  }, [client, id, version]);
  return (
    <span className="rah-computer-agent-error" title={detail}>
      {detail ? `错误：${detail}` : "运行异常"}
    </span>
  );
}
