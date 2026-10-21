import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { Button, Spinner } from "raft-ui";
import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";
import { loadTrajectory } from "./run-details.ts";
import TrajectoryRow from "./TrajectoryRow.tsx";
export default function InstanceTrajectory({
  client,
  agentId,
  instanceId,
  roomId,
}: {
  client: RahClient;
  agentId: string;
  instanceId: string;
  roomId: string;
}) {
  const [cursor, setCursor] = useState<string>();
  const [data, setData] =
    useState<Awaited<ReturnType<typeof loadTrajectory>>>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setData(undefined);
    setError("");
    const read = async () => {
      try {
        const value = await loadTrajectory(
          client,
          { agentId, instanceId, roomId, beforeActivityId: cursor },
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setData(value);
          setError("");
        }
      } catch {
        if (!abort.signal.aborted) {
          setData(undefined);
          setError("工具轨迹暂时无法读取，正在重试。");
        }
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(read, document.hidden ? 15000 : 3000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, agentId, instanceId, roomId, cursor]);
  return (
    <section data-testid="loom-trajectory">
      <div className="border-b border-line-muted px-5 py-2">
        <SectionEyebrow as="div">工具与执行轨迹</SectionEyebrow>
      </div>
      {error ? (
        <p role="alert" className="px-3 text-sm">
          {error}
        </p>
      ) : !data ? (
        <Spinner aria-label="读取工具轨迹" />
      ) : (
        <>
          {data.activities.length === 0 ? (
            <p className="px-3 py-2 text-sm text-foreground-muted">
              本页无本对话轨迹；未记录不代表没有工具调用。
            </p>
          ) : (
            <ul className="px-5 py-3">
              {data.activities.map((record) => (
                <TrajectoryRow key={record.activityId} record={record} />
              ))}
            </ul>
          )}
          <div className="flex gap-2 px-3 py-2">
            {cursor && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCursor(undefined)}
              >
                最新轨迹
              </Button>
            )}
            {data.nextCursor && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCursor(data.nextCursor)}
              >
                更早轨迹
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
