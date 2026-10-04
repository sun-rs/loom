// Diagnostic transport barrier only. It never arms a final interrupt or proves
// a Room mutation. Drivers with code mode enabled must set expectOuterOutput:
// inner completion can precede even the raw outer call notification.
export function createCodexOuterOutputBarrier(expectOuterOutput) {
  let required = expectOuterOutput;
  let completedOutput = false;
  let awaitingOuter = 0;
  let blocked = false;
  let scope;
  const calls = new Map();
  const observedCallIds = new Set();
  return {
    observe(frame) {
      const { method, params } = frame ?? {};
      const item = params?.item;
      if (method === "item/started") {
        if (["dynamicToolCall", "mcpToolCall"].includes(item?.type))
          required = true;
        if (
          required &&
          [
            "commandExecution",
            "fileChange",
            "mcpToolCall",
            "dynamicToolCall",
            "collabAgentToolCall",
            "webSearch",
          ].includes(item?.type)
        ) {
          // A new inner call cannot reuse a previous cell's completed output.
          completedOutput = false;
          if (calls.size === 0) {
            awaitingOuter += 1;
            if (awaitingOuter > 1) blocked = true;
          } else if (calls.size === 1) {
            const outer = calls.values().next().value;
            // No parent-call ID links inner items to cells. Multiple inner
            // calls could belong to a concurrent cell whose raw start is late;
            // conservatively leave this whole turn to finish naturally.
            if (outer.innerSeen) blocked = true;
            outer.innerSeen = true;
          } else blocked = true;
        }
      }
      if (method !== "rawResponseItem/completed") return;
      if (!["custom_tool_call", "custom_tool_call_output"].includes(item?.type))
        return;
      required = true;
      const { threadId, turnId } = params;
      if (
        ![threadId, turnId, item.call_id].every(
          (value) => typeof value === "string" && value.length > 0,
        )
      ) {
        blocked = true;
        return;
      }
      const current = JSON.stringify([threadId, turnId]);
      if (scope !== undefined && scope !== current) return;
      if (item.type === "custom_tool_call") {
        if (observedCallIds.has(item.call_id)) return;
        observedCallIds.add(item.call_id);
        scope = current;
        completedOutput = false;
        if (awaitingOuter > 0 && calls.size > 0) blocked = true;
        calls.set(item.call_id, {
          name: item.name,
          innerSeen: awaitingOuter > 0,
        });
        awaitingOuter = 0;
      } else if (calls.has(item.call_id)) {
        // Only the runtime's leading completion envelope is recognized. An
        // arbitrary nested tool receipt, a yield, or an unknown format cannot
        // establish that code-mode execution finished. After a yield we leave
        // the turn to finish naturally rather than infer cell/wait lifetimes.
        const { name } = calls.get(item.call_id);
        const first = item.output?.[0];
        if (
          !["exec", "wait"].includes(name) ||
          first?.type !== "input_text" ||
          typeof first.text !== "string" ||
          !/^Script completed\nWall time [^\n]+\nOutput:\n/u.test(first.text)
        )
          blocked = true;
        calls.delete(item.call_id);
        completedOutput = awaitingOuter === 0;
      }
    },
    ready() {
      return !required || (completedOutput && !blocked && calls.size === 0);
    },
  };
}
