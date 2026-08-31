import { writeSync } from "node:fs";

const MAX_TEXT = 8_192;
const MAX_TOOL_INPUT = 4_096;
const MAX_DETAIL = 2_048;

/**
 * The sole Provider-native runtime-trajectory boundary. It intentionally
 * accepts untrusted wire frames and returns only the bounded Raft activity
 * vocabulary owned by @rah-os/protocol.
 */
export function normalizeCodexTrajectoryNotification(frame, now = Date.now) {
  if (!isRecord(frame) || typeof frame.method !== "string") return [];
  const params = record(frame.params);
  const method = frame.method;
  if (method === "turn/started") {
    const turn = record(params.turn);
    return trajectory(
      statusEntry(
        "working",
        "model_request_started",
        "模型请求已开始",
        fact(turn.id, method),
      ),
      timestampFrom(params, now),
    );
  }
  if (method === "turn/completed") {
    const turn = record(params.turn);
    const status = string(turn.status) ?? "unknown";
    return trajectory(
      status === "completed"
        ? statusEntry(
            "online",
            "stopped",
            "工作轮次已完成",
            fact(turn.id, method),
          )
        : status === "interrupted"
          ? statusEntry(
              "offline",
              "stopped",
              "工作轮次结束：interrupted",
              fact(turn.id, method),
            )
          : statusEntry(
              "error",
              "runtime_error",
              `工作轮次结束：${status}`,
              fact(turn.id, method),
            ),
      timestampFrom(params, now),
    );
  }
  if (method === "thread/compacted") {
    return trajectory(
      {
        kind: "compaction_finished",
        producerFactId: fact(params.threadId, method),
      },
      timestampFrom(params, now),
    );
  }
  if (method !== "item/started" && method !== "item/completed") return [];
  const item = record(params.item);
  const itemId = string(item.id);
  const itemType = string(item.type);
  if (itemType === undefined) return [];
  const observedAt = timestampFrom(params, now);
  const producerFactId = fact(itemId, method);
  if (itemType === "contextCompaction") {
    return trajectory(
      {
        kind:
          method === "item/started"
            ? "compaction_started"
            : "compaction_finished",
        producerFactId,
      },
      observedAt,
    );
  }
  if (method === "item/started") {
    const tool = codexTool(itemType, item);
    return tool === undefined
      ? []
      : trajectory(
          {
            kind: "tool_start",
            producerFactId,
            ...(tool.input === undefined ? {} : { toolInput: tool.input }),
            toolName: tool.name,
          },
          observedAt,
        );
  }
  if (itemType === "reasoning") {
    // Codex `content` and item/reasoning/textDelta are raw chain-of-thought.
    // Only the explicit public summary is allowed to cross this boundary.
    const summary = Array.isArray(item.summary)
      ? item.summary.filter((value) => typeof value === "string").join("\n")
      : "";
    const text = bounded(summary, MAX_TEXT);
    return text === ""
      ? []
      : trajectory({ kind: "thinking", producerFactId, text }, observedAt);
  }
  if (itemType === "agentMessage") {
    const text = bounded(string(item.text) ?? "", MAX_TEXT);
    return text === ""
      ? []
      : trajectory({ kind: "text", producerFactId, text }, observedAt);
  }
  const completedTool = codexTool(itemType, item);
  return completedTool === undefined
    ? []
    : trajectory(
        statusEntry(
          "working",
          "tool_end",
          `${completedTool.name} 已完成`,
          producerFactId,
        ),
        observedAt,
      );
}

export function normalizeKimiTrajectoryNotification(
  frame,
  activeSessionId,
  now = Date.now,
) {
  if (
    !isRecord(frame) ||
    frame.method !== "session/update" ||
    !isRecord(frame.params) ||
    frame.params.sessionId !== activeSessionId
  ) {
    return [];
  }
  const update = record(frame.params.update);
  const kind = string(update.sessionUpdate);
  const observedAt = new Date(now()).toISOString();
  const content = record(update.content);
  const text =
    content.type === "text"
      ? bounded(string(content.text) ?? "", MAX_TEXT)
      : "";
  const producerFactId = fact(
    string(update.messageId) ?? string(update.toolCallId),
    kind,
  );
  if (kind === "agent_message_chunk" && text !== "") {
    return trajectory({ kind: "text", producerFactId, text }, observedAt);
  }
  if (kind === "agent_thought_chunk" && text !== "") {
    return trajectory({ kind: "thinking", producerFactId, text }, observedAt);
  }
  if (kind === "tool_call") {
    const title = bounded(string(update.title) ?? "工具调用", 512);
    const input = json(update.rawInput, MAX_TOOL_INPUT);
    return trajectory(
      {
        kind: "tool_start",
        producerFactId,
        ...(input === undefined ? {} : { toolInput: input }),
        toolName: title,
      },
      observedAt,
    );
  }
  if (kind === "tool_call_update") {
    const status = string(update.status);
    if (status !== "completed" && status !== "failed") return [];
    const title = bounded(string(update.title) ?? "工具调用", 512);
    return trajectory(
      statusEntry(
        status === "failed" ? "error" : "working",
        status === "failed" ? "runtime_error" : "tool_end",
        `${title}${status === "failed" ? "失败" : "已完成"}`,
        producerFactId,
      ),
      observedAt,
    );
  }
  if (kind === "plan" || kind === "plan_update") {
    const plan = bounded(json(update, MAX_TEXT) ?? "", MAX_TEXT);
    return plan === ""
      ? []
      : trajectory(
          { kind: "system", producerFactId, text: plan, title: "计划" },
          observedAt,
        );
  }
  return [];
}

/**
 * Ports the bounded public event vocabulary used by Raft's Claude stream-json
 * driver. Provider session ids and tool results remain private diagnostics;
 * only user-visible text/thinking, tool lifecycle and terminal status cross
 * into the RAH activity projection.
 */
export function normalizeClaudeTrajectoryEvent(frame, now = Date.now) {
  if (!isRecord(frame) || typeof frame.type !== "string") return [];
  const observedAt = timestampFrom(frame, now);
  if (frame.type === "system") {
    if (frame.subtype === "init") {
      return trajectory(
        statusEntry(
          "working",
          "model_request_started",
          "模型请求已开始",
          "claude:system:init",
        ),
        observedAt,
      );
    }
    if (frame.subtype === "compact_boundary") {
      return trajectory(
        {
          kind: "compaction_finished",
          producerFactId: "claude:system:compact-boundary",
        },
        observedAt,
      );
    }
    if (frame.subtype === "status" && frame.status === "compacting") {
      return trajectory(
        {
          kind: "compaction_started",
          producerFactId: "claude:system:compacting",
        },
        observedAt,
      );
    }
    if (frame.subtype === "status" && frame.status === "requesting") {
      return trajectory(
        statusEntry(
          "working",
          "runtime_progress",
          "Claude 正在请求模型",
          "claude:system:requesting",
        ),
        observedAt,
      );
    }
    return [];
  }
  if (frame.type === "stream_event") {
    const itemType = string(record(frame.event).type) ?? "unknown";
    return trajectory(
      statusEntry(
        "working",
        "runtime_progress",
        `Claude 流事件：${bounded(itemType, 256)}`,
        fact(itemType, "stream-event"),
      ),
      observedAt,
    );
  }
  if (frame.type === "assistant") {
    const content = record(frame.message).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((candidate) => {
      const block = record(candidate);
      const blockId = string(block.id);
      if (block.type === "thinking") {
        const text = bounded(string(block.thinking) ?? "", MAX_TEXT);
        return text === ""
          ? []
          : trajectory(
              {
                kind: "thinking",
                producerFactId: fact(blockId, "thinking"),
                text,
              },
              observedAt,
            );
      }
      if (block.type === "text") {
        const text = bounded(string(block.text) ?? "", MAX_TEXT);
        return text === ""
          ? []
          : trajectory(
              { kind: "text", producerFactId: fact(blockId, "text"), text },
              observedAt,
            );
      }
      if (block.type === "tool_use") {
        const toolName = bounded(string(block.name) ?? "Claude 工具", 512);
        const toolInput = json(block.input, MAX_TOOL_INPUT);
        return trajectory(
          {
            kind: "tool_start",
            producerFactId: fact(blockId, "tool-start"),
            ...(toolInput === undefined ? {} : { toolInput }),
            toolName,
          },
          observedAt,
        );
      }
      return [];
    });
  }
  if (frame.type === "user") {
    const content = record(frame.message).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((candidate) => {
      const block = record(candidate);
      if (block.type !== "tool_result") return [];
      const toolUseId = string(block.tool_use_id);
      const name = bounded(string(block.name) ?? "Claude 工具", 512);
      const failed = block.is_error === true;
      return trajectory(
        statusEntry(
          failed ? "error" : "working",
          failed ? "runtime_error" : "tool_end",
          `${name}${failed ? "失败" : "已完成"}`,
          fact(toolUseId, failed ? "tool-error" : "tool-end"),
        ),
        observedAt,
      );
    });
  }
  if (frame.type === "result") {
    const subtype = string(frame.subtype) ?? "unknown";
    const succeeded = subtype === "success" && frame.is_error !== true;
    const interrupted = subtype === "interrupted";
    const detail = succeeded
      ? "工作轮次已完成"
      : interrupted
        ? "工作轮次结束：interrupted"
        : bounded(
            string(frame.result) ??
              string(frame.error) ??
              `工作轮次结束：${subtype}`,
            MAX_DETAIL,
          );
    return trajectory(
      statusEntry(
        succeeded ? "online" : interrupted ? "offline" : "error",
        succeeded ? "stopped" : interrupted ? "stopped" : "runtime_error",
        detail,
        `claude:result:${bounded(subtype, 128)}`,
      ),
      observedAt,
    );
  }
  if (frame.type === "rate_limit_event") {
    return trajectory(
      statusEntry(
        "working",
        "runtime_progress",
        "Claude 账户限额状态已更新",
        "claude:rate-limit",
      ),
      observedAt,
    );
  }
  return [];
}

/**
 * Projects only bounded OpenCode observations for the active Host-private
 * Provider session. The caller owns part/tool de-duplication; this function is
 * the single untrusted-wire boundary and never turns Provider state into Room
 * or Message truth.
 */
export function normalizeOpenCodeTrajectoryEvent(
  frame,
  activeSessionId,
  now = Date.now,
) {
  if (!isRecord(frame) || typeof frame.type !== "string") return [];
  const properties = record(frame.properties);
  const sessionId = string(properties.sessionID);
  if (sessionId !== activeSessionId) return [];
  const observedAt = timestampFrom(properties, now);
  if (frame.type === "session.status") {
    const status = string(record(properties.status).type);
    if (status === "busy") {
      return trajectory(
        statusEntry(
          "working",
          "runtime_progress",
          "正在处理消息",
          "opencode:session:busy",
        ),
        observedAt,
      );
    }
    if (status === "retry") {
      return trajectory(
        statusEntry(
          "working",
          "runtime_progress",
          bounded(
            string(record(properties.status).message) ?? "Provider 正在重试",
            MAX_DETAIL,
          ),
          "opencode:session:retry",
        ),
        observedAt,
      );
    }
    return [];
  }
  if (frame.type === "session.idle") {
    return trajectory(
      statusEntry(
        "online",
        "stopped",
        "工作轮次已完成",
        "opencode:session:idle",
      ),
      observedAt,
    );
  }
  if (frame.type === "session.error") {
    const error = record(properties.error);
    const data = record(error.data);
    const detail =
      string(data.message) ??
      string(error.message) ??
      string(error.name) ??
      "OpenCode session error";
    return trajectory(
      statusEntry("error", "runtime_error", detail, "opencode:session:error"),
      observedAt,
    );
  }
  if (frame.type === "session.compacted") {
    return trajectory(
      {
        kind: "compaction_finished",
        producerFactId: "opencode:session:compacted",
      },
      observedAt,
    );
  }
  if (frame.type === "permission.asked") {
    const requestId = string(properties.id);
    const permission = string(properties.permission) ?? "工具权限";
    return trajectory(
      statusEntry(
        "working",
        "runtime_progress",
        `已按 Agent 的 Raft 兼容最高权限策略授权：${permission}`,
        fact(requestId, "permission"),
      ),
      observedAt,
    );
  }
  if (frame.type === "question.asked") {
    return trajectory(
      statusEntry(
        "working",
        "runtime_progress",
        "Provider 交互问题已拒绝；Agent 应通过 RAH Worker 请求输入",
        fact(properties.id, "question"),
      ),
      observedAt,
    );
  }
  if (frame.type !== "message.part.updated") return [];
  const part = record(properties.part);
  const partId = string(part.id);
  const partType = string(part.type);
  const producerFactId = fact(partId, partType);
  if (partType === "text") {
    const text = bounded(string(part.text) ?? "", MAX_TEXT);
    return text === ""
      ? []
      : trajectory({ kind: "text", producerFactId, text }, observedAt);
  }
  if (partType === "reasoning") {
    const text = bounded(string(part.text) ?? "", MAX_TEXT);
    return text === ""
      ? []
      : trajectory({ kind: "thinking", producerFactId, text }, observedAt);
  }
  if (partType === "tool") {
    const state = record(part.state);
    const status = string(state.status);
    const name = bounded(string(part.tool) ?? "OpenCode 工具", 512);
    const callId = string(part.callID) ?? partId;
    if (status === "pending" || status === "running") {
      const input = json(state.input, MAX_TOOL_INPUT);
      return trajectory(
        {
          kind: "tool_start",
          producerFactId: fact(callId, "tool-start"),
          ...(input === undefined ? {} : { toolInput: input }),
          toolName: name,
        },
        observedAt,
      );
    }
    if (status === "completed" || status === "error") {
      return trajectory(
        statusEntry(
          status === "error" ? "error" : "working",
          status === "error" ? "runtime_error" : "tool_end",
          status === "error" ? `${name}失败` : `${name}已完成`,
          fact(callId, `tool-${status}`),
        ),
        observedAt,
      );
    }
  }
  if (partType === "compaction") {
    return trajectory(
      {
        kind: "compaction_started",
        producerFactId,
      },
      observedAt,
    );
  }
  return [];
}

export function kimiPromptCompletionTrajectory(stopReason, now = Date.now) {
  const normalized = string(stopReason) ?? "unknown";
  return trajectory(
    normalized === "end_turn"
      ? statusEntry(
          "online",
          "stopped",
          "工作轮次已完成",
          "kimi:prompt:completed",
        )
      : statusEntry(
          normalized === "cancelled" ? "offline" : "error",
          normalized === "cancelled" ? "stopped" : "runtime_error",
          `工作轮次结束：${normalized}`,
          "kimi:prompt:completed",
        ),
    new Date(now()).toISOString(),
  );
}

export function runtimeStatusTrajectory(
  activity,
  detailKind,
  detail,
  producerFactId,
  now = Date.now,
) {
  return trajectory(
    statusEntry(activity, detailKind, detail, producerFactId),
    new Date(now()).toISOString(),
  );
}

export class RuntimeTrajectoryWriter {
  #sequence = 0;
  #write;
  #pending;
  #timer;

  constructor(write = defaultWrite) {
    this.#write = write;
  }

  emit(records) {
    for (const record of records) {
      const entry = record.entry;
      if (entry.kind !== "text" && entry.kind !== "thinking") {
        this.flush();
        this.#writeRecord(record);
        continue;
      }
      // Raft Computer 1.0.18 queueTrajectoryText: 350ms debounce and same-lineage
      // coalescing. Unlike its 2000-char truncation, flush bounded segments so
      // diagnostic output is not lost. One writer belongs to one RunAttempt.
      const previous = this.#pending?.entry;
      if (
        previous &&
        (previous.kind !== entry.kind ||
          previous.producerFactId !== entry.producerFactId ||
          JSON.stringify(previous.subagent ?? null) !==
            JSON.stringify(entry.subagent ?? null))
      )
        this.flush();
      const text = (this.#pending?.entry.text ?? "") + entry.text;
      const base = this.#pending ?? record;
      this.#pending = { ...base, entry: { ...base.entry, text } };
      clearTimeout(this.#timer);
      while (this.#pending.entry.text.length >= 2000) {
        const pending = this.#pending;
        // Keep UTF-16 surrogate pairs intact at the segment boundary.
        const high = pending.entry.text.charCodeAt(1999);
        const end = high >= 0xd800 && high <= 0xdbff ? 1999 : 2000;
        this.#writeRecord({
          ...pending,
          entry: { ...pending.entry, text: pending.entry.text.slice(0, end) },
        });
        this.#pending = {
          ...record,
          entry: { ...entry, text: pending.entry.text.slice(end) },
        };
      }
      this.#timer = setTimeout(() => this.flush(), 350);
    }
  }

  flush() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending?.entry.text) this.#writeRecord(pending);
  }

  #writeRecord(record) {
    this.#sequence += 1;
    try {
      this.#write(
        `${JSON.stringify({ entry: record.entry, observedAt: record.observedAt, producerSequence: this.#sequence })}\n`,
      );
    } catch {
      // Diagnostics cannot crash a Provider turn when fd 3 is unavailable.
    }
  }
}

function defaultWrite(value) {
  writeSync(3, value);
}

function codexTool(itemType, item) {
  if (itemType === "commandExecution") {
    return {
      input: bounded(string(item.command) ?? "", MAX_TOOL_INPUT),
      name: "运行命令",
    };
  }
  if (itemType === "fileChange") {
    return { input: json(item.changes, MAX_TOOL_INPUT), name: "修改文件" };
  }
  if (itemType === "mcpToolCall") {
    const server = string(item.server) ?? "MCP";
    const tool = string(item.tool) ?? "工具";
    return {
      input: json(item.arguments, MAX_TOOL_INPUT),
      name: `${server}/${tool}`,
    };
  }
  if (itemType === "dynamicToolCall") {
    return {
      input: json(item.arguments ?? item.input, MAX_TOOL_INPUT),
      name: bounded(string(item.tool) ?? string(item.name) ?? "动态工具", 512),
    };
  }
  if (itemType === "collabAgentToolCall") {
    return { input: json(item, MAX_TOOL_INPUT), name: "协作 Agent" };
  }
  if (itemType === "subAgentActivity") {
    return { input: json(item, MAX_TOOL_INPUT), name: "子 Agent" };
  }
  if (itemType === "webSearch") {
    return {
      input: bounded(string(item.query) ?? "", MAX_TOOL_INPUT),
      name: "网页搜索",
    };
  }
  if (itemType === "imageView") {
    return {
      input: bounded(string(item.path) ?? "", MAX_TOOL_INPUT),
      name: "查看图片",
    };
  }
  if (itemType === "imageGeneration") return { name: "生成图片" };
  if (itemType === "sleep")
    return { input: json(item, MAX_TOOL_INPUT), name: "等待" };
  return undefined;
}

function statusEntry(activity, detailKind, detail, producerFactId) {
  return {
    activity,
    detail: bounded(detail, MAX_DETAIL),
    detailKind,
    kind: "status",
    producerFactId,
  };
}

function trajectory(entry, observedAt) {
  return [{ entry, observedAt }];
}

function timestampFrom(params, now) {
  for (const key of ["completedAt", "startedAt", "timestamp"]) {
    const value = params[key];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
      return new Date(value).toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
  }
  return new Date(now()).toISOString();
}

function fact(value, suffix) {
  const base = string(value);
  const combined =
    base === undefined ? undefined : `${base}:${suffix ?? "event"}`;
  return combined === undefined ? undefined : bounded(combined, 512);
}

function json(value, maximum) {
  if (value === undefined) return undefined;
  try {
    return bounded(JSON.stringify(value), maximum);
  } catch {
    return bounded(String(value), maximum);
  }
}

function bounded(value, maximum) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function string(value) {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function record(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
