import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentExecutionResetDialog } from "./agent-execution-reset-dialog.tsx";
import {
  applyAgentResetBatch,
  type AgentResetOperation,
} from "../agent-reset-batch.ts";
type Batch = {
  ids: readonly string[];
  completed: Set<string>;
  controller: AbortController;
};
/** Raft Na selection -> three reset modes; reuse existing confirmation/daemon owner. */
export function ComputerAgentReset({
  ids,
  onReset,
  fullResetEnabled,
  disabled,
}: {
  ids: readonly string[];
  onReset: AgentResetOperation | undefined;
  fullResetEnabled: boolean;
  disabled: boolean;
}) {
  const [batch, setBatch] = useState<Batch>();
  const current = useRef<Batch | undefined>(undefined);
  const scope = ids.join("|");
  useEffect(() => {
    current.current?.controller.abort();
    current.current = undefined;
    setBatch(undefined);
    return () => {
      current.current?.controller.abort();
      current.current = undefined;
    };
  }, [scope]);
  return (
    <>
      <button
        className="btn"
        type="button"
        disabled={disabled || !onReset || ids.length === 0}
        onClick={() => {
          const next = {
            ids: [...ids],
            completed: new Set<string>(),
            controller: new AbortController(),
          };
          current.current = next;
          setBatch(next);
        }}
      >
        重启 / 重置所选
      </button>
      {batch &&
        createPortal(
          <AgentExecutionResetDialog
            agentName={`所选 ${batch.ids.length} 个 Agent`}
            fullResetEnabled={fullResetEnabled}
            onClose={() => {
              current.current?.controller.abort();
              current.current = undefined;
              setBatch(undefined);
            }}
            onConfirm={async (mode, key) => {
              if (!onReset) throw new Error("当前不能重启 Agent");
              await applyAgentResetBatch({
                ...batch,
                key,
                mode,
                signal: batch.controller.signal,
                apply: onReset,
              });
            }}
          />,
          document.body,
        )}
    </>
  );
}
