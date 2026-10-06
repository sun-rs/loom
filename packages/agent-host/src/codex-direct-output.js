// Direct MCP transport proof, composed with the existing code-mode barrier.
// It never reads business semantics or arms an interrupt. Ambiguous overlap
// stays on natural completion; a completed prior code-mode cell is supported.
const toolTypes = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "webSearch",
]);
const nonempty = (v) => typeof v === "string" && v.length > 0;
const identity = (p) =>
  [p?.threadId, p?.turnId].every(nonempty)
    ? JSON.stringify([p.threadId, p.turnId])
    : undefined;
const texts = (content) =>
  Array.isArray(content) &&
  content.length > 0 &&
  content.every((p) => p?.type === "text" && typeof p.text === "string")
    ? content.map((p) => p.text)
    : undefined;
const rawTexts = (output) =>
  Array.isArray(output) &&
  output.length > 1 &&
  output.every((p) => p?.type === "input_text" && typeof p.text === "string") &&
  /^Wall time: \d+(?:\.\d+)? seconds\nOutput:$/u.test(output[0].text)
    ? output.slice(1).map((p) => p.text)
    : undefined;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function withCodexDirectOutput(outer) {
  let scope, direct;
  let legacySeen = false,
    mode = "code",
    blocked = false;
  const seen = new Map();
  const finish = () => {
    if (direct.started && direct.native && direct.output) {
      if (!same(direct.native, direct.output)) blocked = true;
      else direct.complete = true;
    }
  };
  return {
    observe(frame) {
      const { method, params: p } = frame ?? {};
      const item = p?.item,
        current = identity(p);
      if (scope !== undefined && current !== undefined && scope !== current)
        return;
      if (scope === undefined && current !== undefined) scope = current;
      if (
        method === "rawResponseItem/completed" &&
        item?.type === "function_call"
      ) {
        if (
          !current ||
          !nonempty(item.call_id) ||
          item.namespace !== "mcp__loom_worker" ||
          item.name !== "loom_reply"
        ) {
          blocked = true;
          return;
        }
        if (seen.has(item.call_id)) {
          if (!same(seen.get(item.call_id), item)) blocked = true;
          return;
        }
        seen.set(item.call_id, item);
        if ((direct && !direct.complete) || (legacySeen && !outer.ready()))
          blocked = true;
        direct = { call: item.call_id, started: false, complete: false };
        mode = "direct";
        return;
      }
      if (
        method === "rawResponseItem/completed" &&
        item?.type === "function_call_output"
      ) {
        if (mode !== "direct" || !direct || item.call_id !== direct.call) {
          blocked = true;
          return;
        }
        if (!current) {
          blocked = true;
          return;
        }
        const value = rawTexts(item.output);
        if (!value || (direct.output && !same(value, direct.output)))
          blocked = true;
        else {
          direct.output = value;
          finish();
        }
        return;
      }
      if (
        ["item/started", "item/completed"].includes(method) &&
        mode === "direct" &&
        item?.type === "mcpToolCall" &&
        item.id === direct?.call
      ) {
        if (
          !current ||
          item.server !== "loom_worker" ||
          item.tool !== "loom_reply"
        ) {
          blocked = true;
          return;
        }
        if (method === "item/started") {
          if (direct.complete || item.status !== "inProgress") blocked = true;
          direct.started = true;
        } else {
          const value = texts(item.result?.content);
          if (
            !direct.started ||
            item.status !== "completed" ||
            item.error != null ||
            !value ||
            (direct.native && !same(value, direct.native))
          )
            blocked = true;
          else {
            direct.native = value;
            finish();
          }
        }
        return;
      }
      const rawCode =
        method === "rawResponseItem/completed" &&
        ["custom_tool_call", "custom_tool_call_output"].includes(item?.type);
      const nativeTool =
        ["item/started", "item/completed"].includes(method) &&
        toolTypes.has(item?.type);
      if (rawCode || nativeTool) {
        if (
          mode === "direct" &&
          (nativeTool || !direct.complete || item.type !== "custom_tool_call")
        )
          blocked = true;
        mode = "code";
        legacySeen = true;
      }
      outer.observe(frame);
    },
    ready() {
      return !blocked && (mode === "direct" ? direct.complete : outer.ready());
    },
  };
}
