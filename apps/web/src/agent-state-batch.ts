/** Ephemeral UI sequencing only; each mutation belongs to the existing Agent owner. */
export async function applyAgentStateBatch(input: {
  ids: readonly string[];
  state: "enabled" | "disabled";
  keys: Map<string, string>;
  currentState: (id: string) => string | undefined;
  apply: (
    id: string,
    state: "enabled" | "disabled",
    key: string,
  ) => Promise<void>;
  signal: AbortSignal;
  onProgress: (completed: number) => void;
}) {
  let completed = 0;
  for (const id of input.ids) {
    if (input.signal.aborted) return;
    if (input.currentState(id) !== input.state) {
      const key = input.keys.get(id) ?? `computer-agent-${crypto.randomUUID()}`;
      input.keys.set(id, key);
      await input.apply(id, input.state, key);
      input.keys.delete(id);
    }
    if (input.signal.aborted) return;
    input.onProgress(++completed);
  }
}
