import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ComputerAgentReset } from "./computer-agent-reset.tsx";
import type { AgentResetOperation } from "../agent-reset-batch.ts";
import { applyAgentStateBatch } from "../agent-state-batch.ts";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";
import { AgentEntityCard } from "./agent-entity-card.tsx";
export type ComputerAgentStateChange = (
  id: string,
  state: "enabled" | "disabled",
  key: string,
) => Promise<void>;
export function ComputerAgentControls({
  bindings,
  onCreate,
  onOpen,
  onSetState,
  onReset,
  fullResetEnabled = false,
}: {
  bindings: readonly {
    agent: WorkspaceAgentView;
    agentDefinitionId: string;
    runtimeLabel: string;
  }[];
  onCreate?: (() => void) | undefined;
  onOpen: (id: string) => void;
  onSetState?: ComputerAgentStateChange | undefined;
  onReset?: AgentResetOperation | undefined;
  fullResetEnabled?: boolean | undefined;
}) {
  const [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [pending, setPending] = useState(false),
    [result, setResult] = useState<string>(),
    [error, setError] = useState<string>();
  const active = useRef<AbortController | undefined>(undefined);
  const keys = useRef(new Map<string, string>());
  const lastAction = useRef<string | undefined>(undefined);
  const scope = bindings
    .map((b) => b.agentDefinitionId)
    .sort()
    .join("|");
  useEffect(() => {
    active.current?.abort();
    active.current = undefined;
    keys.current = new Map();
    setPending(false);
    setSelected([]);
    setResult(undefined);
    setError(undefined);
    return () => {
      active.current?.abort();
      active.current = undefined;
    };
  }, [scope]);
  async function apply(state: "enabled" | "disabled") {
    if (!onSetState || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    if (lastAction.current !== state) keys.current = new Map();
    lastAction.current = state;
    setPending(true);
    setResult(undefined);
    setError(undefined);
    try {
      await applyAgentStateBatch({
        ids: selected,
        state,
        keys: keys.current,
        currentState: (id) =>
          bindings.find((b) => b.agentDefinitionId === id)?.agent.state,
        apply: onSetState,
        signal: controller.signal,
        onProgress: (count) => setResult(`已完成 ${count} 项`),
      });
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "批量操作失败，可重试未完成操作。",
        );
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        setPending(false);
      }
    }
  }
  return (
    <ProfileSection
      title="这台 COMPUTER 上的 AGENT"
      count={bindings.length}
      action={
        <>
          <button
            className="btn"
            type="button"
            disabled={pending || !onSetState || !bindings.length}
            aria-label={selecting ? "结束选择" : "选择 Agent"}
            onClick={() => {
              setSelecting(!selecting);
              setSelected([]);
              setResult(undefined);
              setError(undefined);
            }}
          >
            <Icon name={selecting ? "x" : "check"} />
            {selecting ? "取消" : "选择"}
          </button>
          <button
            className="btn btn-pink"
            type="button"
            aria-label="创建 Agent"
            disabled={!onCreate || pending}
            onClick={onCreate}
          >
            <Icon name="plus" />
            创建
          </button>
        </>
      }
    >
      {selecting ? (
        <div className="rah-computer-bulk-actions">
          <label>
            <input
              type="checkbox"
              aria-label="全选 Agent"
              disabled={pending}
              checked={
                bindings.length > 0 && selected.length === bindings.length
              }
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? bindings.map((b) => b.agentDefinitionId)
                    : [],
                )
              }
            />
            全选
          </label>
          <button
            className="btn"
            type="button"
            disabled={pending || !selected.length}
            onClick={() => void apply("enabled")}
          >
            启用所选
          </button>
          <button
            className="btn"
            type="button"
            disabled={pending || !selected.length}
            onClick={() => void apply("disabled")}
          >
            停用所选
          </button>
          <ComputerAgentReset
            ids={selected}
            onReset={onReset}
            fullResetEnabled={fullResetEnabled}
            disabled={pending}
          />
          {pending ? (
            <span role="status">处理中…</span>
          ) : result ? (
            <span role="status">{result}</span>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
      {bindings.length === 0 ? (
        <p className="rah-computer-hint">当前没有绑定的 Agent。</p>
      ) : (
        <div className="rah-computer-agent-list">
          {bindings.map((binding) => (
            <div
              className="rah-computer-select-row"
              key={binding.agentDefinitionId}
            >
              {selecting ? (
                <input
                  type="checkbox"
                  aria-label={`选择 ${binding.agent.displayName}`}
                  disabled={pending}
                  checked={selected.includes(binding.agentDefinitionId)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, binding.agentDefinitionId]
                        : ids.filter((id) => id !== binding.agentDefinitionId),
                    )
                  }
                />
              ) : null}
              <AgentEntityCard
                agent={binding.agent}
                runtimeLabel={binding.runtimeLabel}
                showStatusLabel
                onOpen={onOpen}
              />
            </div>
          ))}
        </div>
      )}
    </ProfileSection>
  );
}
