import { createHash } from "node:crypto";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const jsonSha = (value) => sha(JSON.stringify(value));
const occurrences = (text, part) => text.split(part).length - 1;

// Pure structural summary of captured OpenAI-compatible chat JSON. The caller
// must separately prove transport capture/coverage. Counts are not token or
// invoice estimates; stored assistant history is not duplicate wake injection.
export function summarizeChatRequest(bytes, options = {}) {
  try {
    const { currentTask, earlierTasks = [] } = options;
    if (
      !(bytes instanceof Uint8Array) ||
      (currentTask !== undefined &&
        (typeof currentTask !== "string" || !currentTask)) ||
      !Array.isArray(earlierTasks) ||
      !earlierTasks.every((s) => typeof s === "string" && s)
    )
      throw Error();
    const request = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
    if (
      typeof request?.model !== "string" ||
      !request.model ||
      !Array.isArray(request.messages) ||
      !request.messages.length ||
      (request.tools !== undefined && !Array.isArray(request.tools))
    )
      throw Error();
    const { messages, tools = [], ...settings } = request;
    let textClassificationComplete = true;
    let reasoningCharacters = 0;
    let latestUser = null;
    const currentTaskUserMessages = [];
    const roleCounts = {};
    for (const [index, message] of messages.entries()) {
      if (!message || typeof message.role !== "string") throw Error();
      const role = message.role;
      if (!["system", "developer", "user", "assistant", "tool"].includes(role))
        textClassificationComplete = false;
      // Do not return provider-supplied role text in public summaries.
      const key = ["system", "developer", "user", "assistant", "tool"].includes(
        role,
      )
        ? role
        : "unknown";
      roleCounts[key] = (roleCounts[key] ?? 0) + 1;
      let text = "";
      if (typeof message.content === "string") text = message.content;
      else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type === "text" && typeof part.text === "string")
            text += part.text;
          else textClassificationComplete = false;
        }
      } else if (message.content != null) textClassificationComplete = false;
      if (typeof message.reasoning_content === "string")
        reasoningCharacters += message.reasoning_content.length;
      else if (message.reasoning_content != null)
        textClassificationComplete = false;
      if (role === "user") {
        const matches =
          currentTask === undefined ? null : occurrences(text, currentTask);
        if (matches > 0)
          currentTaskUserMessages.push({ index, occurrences: matches });
        latestUser = {
          index,
          textCharacters: text.length,
          textSha256: sha(text),
          currentTaskOccurrences: matches,
          earlierTaskOccurrences: earlierTasks.map((task) =>
            occurrences(text, task),
          ),
        };
      }
    }
    return {
      bodyBytes: bytes.byteLength,
      bodySha256: sha(bytes),
      settingsSha256: jsonSha(settings),
      systemSha256: jsonSha(
        messages.filter((m) => ["system", "developer"].includes(m.role)),
      ),
      toolsSha256: jsonSha(tools),
      toolCount: tools.length,
      messagesSha256: jsonSha(messages),
      messageCount: messages.length,
      roleCounts,
      reasoningCharacters,
      textClassificationComplete,
      latestUser,
      currentTaskUserMessages,
      currentTaskOccurrencesInUserMessages:
        currentTask === undefined
          ? null
          : currentTaskUserMessages.reduce((sum, m) => sum + m.occurrences, 0),
      interpretation:
        "Hashes preserve parsed JSON property/array order; differences are structural, not proof of semantic inequality. Text counts are not token estimates. Transport completeness and business comparability are separate.",
    };
  } catch {
    // Parsing failures may contain private request fragments. Never echo them.
    throw new Error("Unsupported chat request evidence");
  }
}
