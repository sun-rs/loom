import { useEffect, useRef, useState } from "react";
import { WorkbenchServiceStatusSchema } from "@rah-os/protocol";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export function WorkbenchServiceRestart() {
  const [generation, setGeneration] = useState<string>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void readStatus(controller.signal)
      .then((status) => {
        if (status.available && !controller.signal.aborted)
          setGeneration(status.generation);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  async function restart() {
    const signal = lifetime.current?.signal;
    if (
      pending ||
      generation === undefined ||
      signal === undefined ||
      signal.aborted
    )
      return;
    setPending(true);
    setMessage("正在重启服务，等待重新连接…");
    try {
      let response: Response | undefined;
      try {
        response = await fetch("/_rah/service/restart", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ generation }),
          credentials: "same-origin",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
      } catch {
        /* A dropped receipt is reconciled against the service generation. */
      }
      if (response !== undefined && response.status !== 202) {
        const result = (await response.json()) as { result?: string };
        if (result.result === "busy")
          throw new Error("Agent 工作尚未结束，请等待后再重启。");
        if (result.result !== "stale")
          throw new Error("重启请求被拒绝，请刷新页面检查登录状态。");
      }
      const deadline = Date.now() + 90_000;
      while (!signal.aborted && Date.now() < deadline) {
        try {
          const status = await readStatus(signal);
          if (
            status.available &&
            status.state === "online" &&
            status.generation !== generation
          ) {
            setGeneration(status.generation);
            setMessage("服务已重启，连接已恢复。");
            return;
          }
        } catch {
          /* Temporary refusal is expected while the gateway is down. */
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      if (!signal.aborted)
        throw new Error("尚未确认服务恢复。可重试核实，或查看本机恢复指南。");
    } catch (error) {
      if (!signal.aborted)
        setMessage(error instanceof Error ? error.message : "重启失败");
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  return (
    <div className="rah-computer-service-restart">
      <button
        className="btn"
        disabled={pending || generation === undefined}
        onClick={() => void restart()}
        type="button"
      >
        <Icon name="refresh-cw" />
        {pending ? "正在重启服务…" : "重启服务"}
      </button>
      <p role="status">
        {message ||
          (generation === undefined
            ? "当前连接未提供服务重启能力。"
            : "重启本机工作台服务，页面将自动重新连接。")}
      </p>
    </div>
  );
}
async function readStatus(signal: AbortSignal) {
  const response = await fetch("/_rah/service", {
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
  });
  if (!response.ok) throw new Error("Service status unavailable");
  return WorkbenchServiceStatusSchema.parse(await response.json());
}
