import { useEffect, useRef, useState } from "react";
import { WorkbenchServiceStatusSchema } from "@rah-os/protocol";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ServiceRestartConfirmation } from "./service-restart-confirmation.tsx";

export function WorkbenchServiceRestart() {
  const [generation, setGeneration] = useState<string>();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const restartLock = useRef(false);
  const [message, setMessage] = useState("");
  const [statusState, setStatusState] = useState<
    "loading" | "available" | "unavailable" | "error"
  >("loading");
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void refreshStatus(controller.signal);
    return () => controller.abort();
  }, []);
  async function refreshStatus(signal = lifetime.current?.signal) {
    if (signal === undefined || signal.aborted) return;
    setStatusState("loading");
    setMessage("");
    try {
      const status = await readStatus(signal);
      if (signal.aborted) return;
      if (!status.available) {
        setGeneration(undefined);
        setStatusState("unavailable");
      } else if (status.state === "failed") {
        setGeneration(undefined);
        setStatusState("error");
        setMessage("服务启动失败，请按本机恢复指南处理后重试连接。");
      } else {
        setGeneration(status.generation);
        setStatusState("available");
      }
    } catch {
      if (!signal.aborted) {
        setGeneration(undefined);
        setStatusState("error");
      }
    }
  }
  async function restart() {
    const signal = lifetime.current?.signal;
    if (
      restartLock.current ||
      generation === undefined ||
      signal === undefined ||
      signal.aborted
    )
      return;
    restartLock.current = true;
    setConfirmOpen(false);
    setPending(true);
    setMessage("");
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
        if (result.result === "stale") {
          const status = await readStatus(signal);
          if (signal.aborted) return;
          if (status.available && status.state === "online") {
            setGeneration(status.generation);
            setMessage("");
          } else {
            setGeneration(undefined);
            setStatusState("error");
            setMessage("服务状态已变化，请重试连接以确认恢复。");
          }
          return;
        }
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
            setMessage("");
            return;
          }
        } catch {
          /* Temporary refusal is expected while the gateway is down. */
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      if (!signal.aborted) {
        setGeneration(undefined);
        setStatusState("error");
        throw new Error("尚未确认服务恢复。请按本机恢复指南处理后重试连接。");
      }
    } catch (error) {
      if (!signal.aborted)
        setMessage(error instanceof Error ? error.message : "重启失败");
    } finally {
      restartLock.current = false;
      if (!signal.aborted) setPending(false);
    }
  }
  return (
    <div className="rah-computer-service-restart">
      <button
        className="btn btn-coral"
        disabled={
          pending || statusState !== "available" || generation === undefined
        }
        onClick={() => setConfirmOpen(true)}
        type="button"
      >
        <Icon
          name="refresh-cw"
          className={pending ? "rah-service-restart-spinning" : ""}
        />
        {pending ? "正在重启服务…" : "重启服务"}
      </button>
      {statusState === "error" && (
        <button
          className="btn"
          disabled={pending}
          onClick={() => void refreshStatus()}
          type="button"
        >
          重试连接
        </button>
      )}
      {statusState !== "available" || message ? (
        <p role="status">
          {message ||
            (statusState === "loading"
              ? "正在读取服务状态…"
              : statusState === "error"
                ? "暂时无法读取服务状态，请重试。"
                : statusState === "unavailable"
                  ? "当前连接未提供服务重启能力。"
                  : "重启本机工作台服务，页面将自动重新连接。")}
        </p>
      ) : null}
      {confirmOpen && (
        <ServiceRestartConfirmation
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => void restart()}
        />
      )}
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
