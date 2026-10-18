import { uiActionProps } from "./ui-action-props.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Room } from "@rah-os/protocol";
import { Button } from "raft-ui";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog.tsx";
import { showToast } from "../packages/web/src/components/toastBridge.ts";
import { BranchClient, branchSupported } from "./branch-client.ts";
import { useIntentRoute, useRouteIntentOwner } from "./useIntentRoute.ts";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
export type BranchSource = { instanceId: string; channelId: string };
export function useInstanceBranches(
  client: RahClient,
  workspaceId: string,
  agentId: string,
  source: BranchSource | undefined,
  active: boolean,
  onBranched?: () => void,
) {
  const [, setParams] = useIntentRoute();
  const owner = useMemo(
    () => new BranchClient(client, source?.channelId ?? "unavailable"),
    [client, source?.channelId, source?.instanceId],
  );
  useRouteIntentOwner(owner.writes);
  const [state, setState] = useState(owner.writes.state),
    [mode, setMode] = useState<"fork" | "side">(),
    [supported, setSupported] = useState<boolean>(),
    [error, setError] = useState(""),
    [sides, setSides] = useState<Room[]>([]);
  useEffect(() => {
    const stop = owner.writes.onChange(setState);
    return () => {
      stop();
      owner.writes.discard();
    };
  }, [owner]);
  const sideRead = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => sideRead.current?.abort(),
    [client, workspaceId, source?.instanceId, active],
  );
  const refreshSides = async () => {
    sideRead.current?.abort();
    if (!source || !active) return;
    const abort = new AbortController();
    sideRead.current = abort;
    try {
      const { rooms } = await client.request(
        "room.list",
        { workspaceId },
        { signal: abort.signal },
      );
      if (!abort.signal.aborted)
        setSides(
          rooms.filter((r) => r.side?.sourceInstanceId === source.instanceId),
        );
    } catch {
      if (!abort.signal.aborted) setSides([]);
    }
  };
  useEffect(() => {
    if (!mode || !source) return;
    const abort = new AbortController();
    setSupported(undefined);
    setError("");
    void Promise.all([
      client.request("agent.get", { agentId }, { signal: abort.signal }),
      client.request("host.runtime.list", {}, { signal: abort.signal }),
    ])
      .then(([current, inventory]) => {
        if (!abort.signal.aborted)
          setSupported(branchSupported(current, inventory.runtimes, mode));
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("无法核实原生复制能力，请关闭后重试。");
      });
    return () => abort.abort();
  }, [client, agentId, mode, source?.instanceId]);
  const openSide = (roomId: string) => {
    if (!source || hasUnresolvedIntents()) return;
    setParams({ room: source.channelId, side: roomId });
  };
  const begin = (next: "fork" | "side") => {
    if (!hasUnresolvedIntents()) {
      setSupported(undefined);
      setError("");
      setMode(next);
    }
  };
  return {
    refreshSides,
    busy: state !== "idle",
    items: source
      ? [
          { label: "Fork · 分叉为新成员", run: () => begin("fork") },
          { label: "Side · 打开独立侧聊", run: () => begin("side") },
          ...sides.map((room) => ({
            label: `Side · ${room.name}${room.side?.discarded ? "（已丢弃）" : room.side?.discarding ? "（正在关闭）" : ""}`,
            run: () => openSide(room.roomId),
          })),
        ]
      : [],
    dialog:
      mode && source ? (
        <ConfirmDialog
          title={mode === "fork" ? "分叉为新成员" : "打开独立 Side"}
          confirmLabel={mode === "fork" ? "创建 Fork" : "创建 Side"}
          confirmVariant="primary"
          closeOnConfirm={false}
          confirmDisabled={supported !== true || state !== "idle"}
          onClose={() => {
            if (owner.writes.state === "idle") setMode(undefined);
          }}
          message={
            <>
              <p>
                {mode === "fork"
                  ? "复制当前上下文，创建同 Role、同冻结配置的新频道成员。新实例拥有独立身份；不继承任务负责人或源私聊权限。"
                  : "复制当前上下文，开启独立侧聊。可按权限读取源频道消息和记忆，只能回复自己的侧聊；不会向频道发言或修改主会话。"}
              </p>
              <p className="mt-3">
                {supported === undefined
                  ? "正在核实原生复制能力…"
                  : supported
                    ? "源实例须空闲且已建立会话。复制本身不调用模型。"
                    : "当前运行时不支持此操作，或实例未使用共享频道目录。"}
              </p>
              {error && <p role="alert">{error}</p>}
              {state === "pending" && <p role="status">正在复制上下文…</p>}
              {state === "unknown" && (
                <div role="alert">
                  结果未知，不能重新创建。
                  <Button
                    {...uiActionProps.recovery}
                    onClick={() => void owner.writes.retry()}
                  >
                    核实分支结果
                  </Button>
                  <Button
                    {...uiActionProps.recovery}
                    onClick={() => {
                      owner.writes.abandon();
                      setMode(undefined);
                    }}
                  >
                    放弃核实
                  </Button>
                </div>
              )}
            </>
          }
          onConfirm={async () => {
            await owner.create(source.instanceId, mode, (outcome) => {
              if (outcome.kind === "ok") {
                setMode(undefined);
                onBranched?.();
                showToast({
                  title: `已创建 ${outcome.result.agent.handle}`,
                  type: "success",
                });
                if ("side" in outcome.result)
                  openSide(outcome.result.side.roomId);
              } else if (outcome.kind === "rejected")
                setError(
                  outcome.error instanceof Error
                    ? outcome.error.message
                    : "创建被拒绝，请确认源实例空闲且已建立会话。",
                );
            });
          }}
        />
      ) : null,
  };
}
