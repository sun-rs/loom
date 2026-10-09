import { isKimiLocalChunk } from "./kimi-acp-events.js";

const MAX_BYTES = 1024 * 1024;
const record = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const nonempty = (x) => typeof x === "string" && x.trim() !== "";

/** Native evidence only; this module has no Worker or business-state owner. */
export function createKimiAcpFinalOutput(binding) {
  const bound = structuredClone(binding);
  const tools = new Map();
  let invalid = false;
  let text = "";
  let settled = false;
  return {
    observe(sessionId, update) {
      if (settled) return;
      if (sessionId !== bound.sessionId || !record(update)) {
        invalid = true;
        return;
      }
      const kind = update.sessionUpdate;
      if (kind === "agent_message_chunk" && !isKimiLocalChunk(update)) {
        if (
          update.content?.type !== "text" ||
          typeof update.content.text !== "string"
        )
          invalid = true;
        else text += update.content.text;
        if (Buffer.byteLength(text) > MAX_BYTES) invalid = true;
      }
      if (kind === "tool_call" || kind === "tool_call_update") {
        const id = update.toolCallId;
        // Kimi ACP links its terminal using a display-only update with no
        // status. It cannot create a tool or change its execution state.
        if (kind === "tool_call_update" && update.status === undefined) {
          if (!nonempty(id) || !tools.has(id)) invalid = true;
          return;
        }
        if (
          !["pending", "in_progress", "completed", "failed"].includes(
            update.status,
          )
        )
          invalid = true;
        if (!nonempty(id) || (kind === "tool_call_update" && !tools.has(id)))
          invalid = true;
        if (kind === "tool_call") text = "";
        // Failed tools are terminal; they do not imply that the turn failed.
        tools.set(id, ["completed", "failed"].includes(update.status));
      }
    },
    settle(evidence) {
      if (settled) return undefined;
      settled = true;
      try {
        if (
          invalid ||
          [...tools.values()].some((x) => !x) ||
          evidence.cancelled ||
          evidence.stopReason !== "end_turn" ||
          evidence.launchId !== bound.launchId ||
          evidence.sessionId !== bound.sessionId ||
          evidence.promptId !== bound.promptId ||
          !nonempty(bound.launchId) ||
          !nonempty(bound.sessionId) ||
          !Number.isSafeInteger(bound.promptId)
        )
          return undefined;
        for (const key of ["path", "device", "inode", "offset", "prefixSha256"])
          if (bound.wire[key] !== evidence.wire[key]) return undefined;
        const suffix = evidence.wire.suffix;
        if (
          typeof suffix !== "string" ||
          !suffix.endsWith("\n") ||
          Buffer.byteLength(suffix) > 16 * MAX_BYTES
        )
          return undefined;
        const rows = suffix
          .split("\n")
          .filter((x) => x.trim())
          .map((x) => JSON.parse(x));
        const prompts = rows.filter((x) => x.type === "turn.prompt");
        if (
          prompts.length !== 1 ||
          prompts[0].agentId !== "main" ||
          !Array.isArray(prompts[0].input) ||
          prompts[0].input.some(
            (p) => p.type !== "text" || typeof p.text !== "string",
          ) ||
          prompts[0].input.map((p) => p.text).join("") !== bound.promptText
        )
          return undefined;
        const start = rows.indexOf(prompts[0]);
        if (
          rows
            .slice(0, start)
            .some((x) =>
              [
                "context.append_loop_event",
                "llm.request",
                "turn.ended",
              ].includes(x.type),
            )
        )
          return undefined;
        let turnId,
          step,
          final,
          ended = false;
        const wireTools = new Set();
        for (const row of rows.slice(start + 1)) {
          if (
            ["llm.request", "context.append_loop_event", "turn.ended"].includes(
              row.type,
            ) &&
            (row.agentId !== "main" || ended)
          )
            return undefined;
          if (
            row.type === "llm.request" &&
            (row.modelAlias !== bound.model ||
              row.thinkingEffort !== bound.effort ||
              row.kind !== "loop" ||
              !step ||
              row.turnStep !== `${turnId}.${step.number}`)
          )
            return undefined;
          if (row.type === "llm.request" && step) step.requested = true;
          if (row.type === "turn.ended") {
            if (
              row.reason !== "completed" ||
              String(row.turnId) !== turnId ||
              !final ||
              step ||
              wireTools.size
            )
              return undefined;
            ended = true;
          }
          if (row.type !== "context.append_loop_event") continue;
          const e = row.event;
          if (!record(e)) return undefined;
          if (e.turnId !== undefined) {
            turnId ??= String(e.turnId);
            if (String(e.turnId) !== turnId) return undefined;
          }
          if (e.type === "step.begin") {
            if (step || final || !nonempty(e.uuid)) return undefined;
            step = { id: e.uuid, number: e.step, text: "", requested: false };
          } else if (e.type === "content.part") {
            if (!step || e.stepUuid !== step.id || e.step !== step.number)
              return undefined;
            if (e.part?.type === "text") {
              if (typeof e.part.text !== "string") return undefined;
              step.text += e.part.text;
            }
          } else if (e.type === "tool.call") {
            if (!step || !nonempty(e.toolCallId) || wireTools.has(e.toolCallId))
              return undefined;
            wireTools.add(e.toolCallId);
          } else if (e.type === "tool.result") {
            if (!wireTools.delete(e.toolCallId)) return undefined;
          } else if (e.type === "step.end") {
            if (
              !step ||
              !step.requested ||
              e.uuid !== step.id ||
              e.step !== step.number ||
              wireTools.size
            )
              return undefined;
            if (e.finishReason === "end_turn")
              final = { text: step.text, id: e.messageId };
            else if (e.finishReason !== "tool_use") return undefined;
            step = undefined;
          }
        }
        if (
          !ended ||
          !final ||
          !nonempty(final.text) ||
          !nonempty(final.id) ||
          final.text !== text ||
          Buffer.byteLength(text) > MAX_BYTES
        )
          return undefined;
        return Object.freeze({
          launchId: bound.launchId,
          sessionId: bound.sessionId,
          turnId: `session/prompt#${bound.promptId}`,
          nativeMessageId: final.id,
          text: final.text,
        });
      } catch {
        return undefined;
      }
    },
  };
}
