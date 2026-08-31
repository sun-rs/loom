import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import {
  AgentMemoryConfigPatchSchema,
  type AgentMemoryConfigSnapshot,
} from "@rah-os/protocol";
import { useDialogProtocol } from "../dialog-protocol.ts";

/** Same Human client / Computer owner as the memory pane, no UI config store. */
export function AgentMemoryConfigDialog({
  agentDefinitionId,
  client,
  onClose,
  onSaved,
}: {
  agentDefinitionId: string;
  client: RahClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<AgentMemoryConfigSnapshot>();
  const [enabled, setEnabled] = useState("true");
  const [threshold, setThreshold] = useState("");
  const [interval, setInterval] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const pendingRef = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const apply = (next: AgentMemoryConfigSnapshot) => {
    setConfig(next);
    setEnabled(String(next.effective.enabled));
    setThreshold(String(next.effective.threshold_bytes));
    setInterval(String(next.effective.interval_ms));
  };
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setConfig(undefined);
    setError(undefined);
    setConflict(false);
    setSaved(false);
    void client
      .request(
        "agent.memory.config.get",
        { agentDefinitionId },
        { signal: controller.signal },
      )
      .then((response) => {
        if (!controller.signal.aborted) apply(response.config);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : "读取失败");
      });
    return () => controller.abort();
  }, [agentDefinitionId, client, reload]);

  const candidate = AgentMemoryConfigPatchSchema.safeParse({
    expectedRevision: config?.revision,
    set: {
      enabled: enabled === "true",
      threshold_bytes: Number(threshold),
      interval_ms: Number(interval),
    },
  });
  async function save(defaults: boolean) {
    if (
      !config ||
      pendingRef.current ||
      conflict ||
      (!defaults && !candidate.success)
    )
      return;
    pendingRef.current = true;
    setPending(true);
    setError(undefined);
    setSaved(false);
    const controller = lifetime.current!;
    try {
      const patch = defaults
        ? {
            expectedRevision: config.revision,
            unset: ["enabled", "threshold_bytes", "interval_ms"] as const,
          }
        : candidate.data!;
      const response = await client.request(
        "agent.memory.config.patch",
        {
          agentDefinitionId,
          patch: AgentMemoryConfigPatchSchema.parse(patch),
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      apply(response.config);
      setSaved(true);
      onSaved();
    } catch (caught) {
      if (controller.signal.aborted) return;
      const stale =
        caught !== null &&
        typeof caught === "object" &&
        "status" in caught &&
        caught.status === 409 &&
        "code" in caught &&
        caught.code === "agent_memory_config_conflict";
      setConflict(stale);
      setError(
        stale
          ? "设置已在其他页面或 Agent 中修改。请重新读取，再确认修改；本次没有覆盖。"
          : caught instanceof Error
            ? caught.message
            : "保存失败",
      );
    } finally {
      pendingRef.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭大小提醒设置"
        disabled={pending}
        onClick={onClose}
      />
      <section
        className="rah-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rah-cleaner-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header>
          <div>
            <h2 id="rah-cleaner-title">大小提醒设置</h2>
            <p>system.cleaner · 版本 {config?.revision ?? "…"}</p>
          </div>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <p>只控制 MEMORY.md 大小提醒；关闭提醒不会停止读取或保存记忆。</p>
          <label>
            大小提醒
            <select
              disabled={pending || !config}
              value={enabled}
              onChange={(e) => {
                setEnabled(e.target.value);
                setSaved(false);
              }}
            >
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
          </label>
          <label>
            索引阈值（字节）
            <input
              type="number"
              min={4096}
              max={1073741824}
              step={1}
              disabled={pending || !config}
              value={threshold}
              onChange={(e) => {
                setThreshold(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label>
            检查间隔（毫秒）
            <input
              type="number"
              min={900000}
              max={604800000}
              step={1}
              disabled={pending || !config}
              value={interval}
              onChange={(e) => {
                setInterval(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          {error ? (
            <p className="rah-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          {error ? (
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={() => setReload((value) => value + 1)}
            >
              重新读取
            </button>
          ) : null}
          {saved ? (
            <p role="status">
              已保存到 Computer，版本 {config?.revision}。下次启动仍使用此设置。
            </p>
          ) : null}
          <footer>
            <button
              className="btn"
              type="button"
              disabled={pending || !config || conflict}
              onClick={() => void save(true)}
            >
              恢复默认
            </button>
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="btn btn-pink"
              disabled={pending || conflict || !candidate.success}
            >
              {pending ? "正在保存…" : "保存更改"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
