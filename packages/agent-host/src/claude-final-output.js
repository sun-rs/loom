import { claudeResultInputUuids } from "./claude-stream-launch.js";

/** Native evidence only, scoped to one accepted stdin input; never a Room writer. */
export function createClaudeFinalOutput({ sessionId, inputUuid }) {
  let invalid = ![sessionId, inputUuid].every(
    (id) => typeof id === "string" && id.trim() !== "",
  );
  let current;
  let final;
  let completed = false;
  const seen = new Set();
  const tools = new Set();
  return {
    invalidate() {
      invalid = true;
    },
    observe(frame) {
      if (invalid || completed) return;
      if (
        frame?.type === "error" ||
        (frame?.type === "stream_event" && frame.event?.type === "error")
      ) {
        invalid = true;
        return;
      }
      if (
        !["assistant", "stream_event", "result", "user"].includes(frame?.type)
      )
        return;
      if (
        frame.session_id !== sessionId ||
        frame.parent_tool_use_id != null ||
        (frame.isReplay === true && frame.type !== "user")
      ) {
        invalid = true;
        return;
      }
      const event = frame.event;
      if (frame.type === "stream_event") {
        if (event?.type === "message_start") {
          const id = event.message?.id;
          if (
            current ||
            final ||
            typeof id !== "string" ||
            id.trim() === "" ||
            seen.has(id)
          ) {
            invalid = true;
            return;
          }
          seen.add(id);
          current = { id, text: undefined, stop: undefined, tool: false };
        } else if (event?.type === "message_delta") {
          if (!current || current.stop !== undefined) {
            invalid = true;
            return;
          }
          current.stop = event.delta?.stop_reason;
        } else if (event?.type === "message_stop") {
          if (!current) {
            invalid = true;
            return;
          }
          if (
            current.stop === "end_turn" &&
            !current.tool &&
            tools.size === 0 &&
            typeof current.text === "string" &&
            current.text.trim() !== ""
          )
            final = { text: current.text, nativeMessageId: current.id };
          else if (current.stop !== "tool_use" || !current.tool) invalid = true;
          current = undefined;
        }
      } else if (frame.type === "assistant") {
        if (
          !current ||
          frame.message?.id !== current.id ||
          !Array.isArray(frame.message?.content)
        ) {
          invalid = true;
          return;
        }
        for (const block of frame.message.content) {
          if (block.type === "tool_use") {
            current.tool = true;
            tools.add(block.id);
          }
          if (block.type === "text") {
            if (
              typeof block.text !== "string" ||
              Buffer.byteLength(block.text, "utf8") > 65536 ||
              current.text !== undefined
            ) {
              invalid = true;
              return;
            }
            current.text = block.text;
          }
        }
      } else if (frame.type === "user") {
        for (const block of frame.message?.content ?? [])
          if (block.type === "tool_result") tools.delete(block.tool_use_id);
      } else if (frame.type === "result") {
        const named = claudeResultInputUuids(frame);
        completed = true;
        invalid =
          current !== undefined ||
          !final ||
          tools.size !== 0 ||
          named.length !== 1 ||
          named[0] !== inputUuid ||
          frame.subtype !== "success" ||
          frame.is_error !== false ||
          frame.stop_reason !== "end_turn" ||
          frame.result !== final.text;
      }
    },
    candidate() {
      return completed && !invalid ? final : undefined;
    },
  };
}
