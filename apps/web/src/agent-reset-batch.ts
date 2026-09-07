import type { AgentExecutionResetMode } from "@rah-os/protocol";
export type AgentResetOperation = (
  id: string,
  mode: AgentExecutionResetMode,
  key: string,
) => Promise<void>;
/** UI progress only: each reset and its replay receipt remain daemon-owned. */
export async function applyAgentResetBatch(input: {
  ids: readonly string[];
  mode: AgentExecutionResetMode;
  key: string;
  completed: Set<string>;
  signal: AbortSignal;
  apply: AgentResetOperation;
}) {
  for (const [index, id] of input.ids.entries()) {
    input.signal.throwIfAborted();
    if (!input.completed.has(id)) {
      await input.apply(id, input.mode, `${input.key}:${index}`);
      input.completed.add(id);
    }
    input.signal.throwIfAborted();
  }
}
