// Gate diagnostics only: preserve explicit tool IDs/results; unknown executable
// formats fail closed. This never executes provider text or infers Room state.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { realpathSync } from "node:fs";
import { transcript } from "./common.mjs";
import {
  readClaudeTranscriptWithSubagents,
  readKimiWire,
} from "./provider-files.mjs";
import { claudeTranscriptRound } from "./claude-usage.mjs";
import { assertClaudeTranscriptModel } from "./native-claude.mjs";
import {
  assertOpenCodeAssistants,
  readOpenCodeRound,
  openCodeSessionDirectory,
  openCodeDatabasePath,
} from "./drift-opencode-guard.mjs";
import { assertKimiRequests, kimiWireRound } from "./kimi-usage.mjs";
// Exact-format admission evidence: docs/evo/evidence/2026-10-09-production-cost-preflight/provider-format-audit.json
export const MULTI_PROVIDER_VERSIONS = Object.freeze({
  codex: ["codex-cli 0.160.0", "codex-cli 0.160.1"],
  claude: ["2.1.287 (Claude Code)", "2.1.293 (Claude Code)"],
  kimi: ["0.39.1"],
  opencode: ["1.18.32", "1.18.35"],
});
export function assertMultiProviderVersion(provider, version) {
  assert.ok(
    MULTI_PROVIDER_VERSIONS[provider]?.includes(version),
    "Unregistered CLI version",
  );
}
const jsonl = (text) =>
  String(text)
    .split("\n")
    .filter((x) => x.trim())
    .map((x) => JSON.parse(x));
const fail = (type) => {
  throw Error("Unknown provider evidence: " + type);
};
export function normalizeBusinessEvents(provider, rows) {
  if (provider === "codex") return rows;
  const out = [];
  let nativePublication, nativeInput;
  const emit = (at, payload) => {
    assert.ok(Number.isFinite(Date.parse(at)), "Missing provider timestamp");
    out.push({
      type: "response_item",
      timestamp: at,
      payload,
      ...(nativePublication ? { nativePublication } : {}),
      ...(nativeInput ? { nativeInput } : {}),
    });
  };
  const message = (at, text) =>
    emit(at, {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    });
  const call = (at, id, name, args) => {
    assert.ok(typeof id === "string" && id, "Missing native tool ID");
    if (["Bash", "bash", "Shell"].includes(name)) {
      assert.ok(
        args &&
          Object.keys(args).every((k) =>
            ["command", "description", "timeout", "run_in_background"].includes(
              k,
            ),
          ),
        "Unknown shell options",
      );
      assert.ok(
        (args.timeout === undefined ||
          (Number.isSafeInteger(args.timeout) && args.timeout > 0)) &&
          (args.description === undefined ||
            typeof args.description === "string") &&
          (args.run_in_background === undefined ||
            args.run_in_background === false),
        "Unverified shell options/background execution",
      );
      name = "exec_command";
      args = { cmd: args.command };
    }
    emit(at, {
      type: "function_call",
      call_id: id,
      name,
      arguments: JSON.stringify(args),
    });
  };
  const result = (at, id, content, isError = false) =>
    emit(at, {
      type: "function_call_output",
      call_id: id,
      output: JSON.stringify({
        isError,
        content:
          typeof content === "string"
            ? [{ type: "text", text: content }]
            : content,
      }),
    });
  for (const row of rows) {
    nativePublication = undefined;
    nativeInput =
      provider === "opencode" &&
      row.role === "user" &&
      [row.nativeSessionId, row.nativeMessageId].every(
        (v) => typeof v === "string" && v,
      )
        ? {
            provider: "opencode",
            sessionId: row.nativeSessionId,
            nativeTurnId: row.nativeMessageId,
          }
        : undefined;
    if (
      provider === "opencode" &&
      row.role === "assistant" &&
      [row.nativeSessionId, row.nativeMessageId, row.nativeParentId].every(
        (v) => typeof v === "string" && v.length > 0,
      )
    )
      nativePublication = {
        provider: "opencode",
        sessionId: row.nativeSessionId,
        messageId: row.nativeMessageId,
        nativeTurnId: row.nativeParentId,
      };
    if (provider === "claude") {
      if (!["user", "assistant"].includes(row.type)) continue;
      assert.ok(!row.isSidechain, "Unregistered sidechain execution");
      const at = row.timestamp,
        c = row.message?.content;
      if (typeof c === "string") {
        if (row.type === "user") message(at, c);
        continue;
      }
      assert.ok(Array.isArray(c), "Unknown Claude content");
      for (const p of c) {
        if (p.type === "text") {
          if (row.type === "user") message(at, p.text);
        } else if (["thinking", "redacted_thinking"].includes(p.type)) continue;
        else if (p.type === "tool_use") call(at, p.id, p.name, p.input);
        else if (p.type === "tool_result")
          result(at, p.tool_use_id, p.content, p.is_error === true);
        else fail(p.type);
      }
    } else if (provider === "kimi") {
      if (row.agentId !== undefined)
        assert.equal(row.agentId, "main", "Unregistered Kimi subagent");
      const at =
        typeof row.time === "number"
          ? new Date(row.time).toISOString()
          : undefined;
      if (row.type === "context.append_message") {
        const m = row.message;
        if (m?.role === "user") {
          if (typeof m.content === "string") message(at, m.content);
          else
            for (const c of m.content ?? []) {
              if (c.type !== "text") fail(c.type);
              message(at, c.text);
            }
        }
      } else if (row.type === "context.append_loop_event") {
        const e = row.event;
        if (e.type === "tool.call") call(at, e.toolCallId, e.name, e.args);
        else if (e.type === "tool.result") {
          assert.ok(
            typeof e.result?.output === "string",
            "Unknown Kimi tool result",
          );
          result(at, e.toolCallId, e.result.output, Boolean(e.result.error));
        } else if (!["step.begin", "step.end", "content.part"].includes(e.type))
          fail(e.type);
      } else if (
        /tool/iu.test(row.type) &&
        row.type !== "llm.tools_snapshot" &&
        row.type !== "mcp.tools_discovered"
      )
        fail(row.type);
    } else if (provider === "opencode") {
      const p = row.part,
        at = row.timestamp;
      if (p.type === "text") {
        if (row.role === "user") message(at, p.text);
      } else if (p.type === "tool") {
        assert.ok(
          ["completed", "error"].includes(p.state?.status),
          "unfinished OpenCode tool",
        );
        call(at, p.callID, p.tool, p.state.input);
        result(
          row.completedAt ?? at,
          p.callID,
          p.state.output ?? p.state.error,
          p.state.status === "error",
        );
      } else if (
        ![
          "reasoning",
          "step-start",
          "step-finish",
          "snapshot",
          "compaction",
        ].includes(p.type)
      )
        fail(p.type);
    } else fail(provider);
  }
  return out;
}
export function readMultiProviderEvents(provider, sessionId) {
  if (provider === "codex") return transcript(sessionId);
  if (provider === "claude")
    return normalizeBusinessEvents(
      provider,
      jsonl(readClaudeTranscriptWithSubagents(sessionId)),
    );
  if (provider === "kimi")
    return normalizeBusinessEvents(provider, jsonl(readKimiWire(sessionId)));
  if (provider !== "opencode") return fail(provider);
  const db = new DatabaseSync(openCodeDatabasePath(), { readOnly: true });
  try {
    const rows = db
      .prepare(
        `WITH RECURSIVE tree(id) AS (SELECT ? UNION SELECT s.id FROM session s JOIN tree t ON s.parent_id=t.id)
   SELECT p.time_created,p.data,p.session_id,p.message_id,m.data AS message FROM part p JOIN message m ON m.id=p.message_id
   WHERE p.session_id IN (SELECT id FROM tree) ORDER BY p.time_created,p.id`,
      )
      .all(sessionId);
    return normalizeBusinessEvents(
      provider,
      rows.map((r) => {
        const p = JSON.parse(r.data);
        return {
          part: p,
          nativeSessionId: r.session_id,
          nativeMessageId: r.message_id,
          nativeParentId: JSON.parse(r.message).parentID,
          role: JSON.parse(r.message).role,
          timestamp: new Date(
            p.time?.start ?? p.state?.time?.start ?? r.time_created,
          ).toISOString(),
          ...(p.state?.time?.end
            ? { completedAt: new Date(p.state.time.end).toISOString() }
            : {}),
        };
      }),
    );
  } finally {
    db.close();
  }
}
export function assertMultiProviderIdentity({ config, round, cwd, events }) {
  const lo = Date.parse(round.startedAt),
    hi = Date.parse(round.finishedAt);
  if (config.provider === "codex") {
    const rows = events ?? transcript(round.sessionId),
      metas = rows.filter((e) => e.type === "session_meta");
    assert.ok(
      metas.length && metas.every((e) => e.payload.memory_mode === "disabled"),
      "Native memory not disabled",
    );
    const contexts = rows.filter(
      (e) =>
        e.type === "turn_context" &&
        Date.parse(e.timestamp) >= lo &&
        Date.parse(e.timestamp) <= hi,
    );
    assert.ok(contexts.length, "Missing actual model context");
    for (const e of contexts) {
      assert.equal(e.payload.model, config.model);
      assert.equal(e.payload.effort, config.effort);
      assert.equal(
        realpathSync(e.payload.cwd),
        realpathSync(cwd),
        "Actual CLI workspace changed",
      );
    }
  } else if (config.provider === "claude") {
    const r = claudeTranscriptRound(
      readClaudeTranscriptWithSubagents(round.sessionId),
      { from: round.startedAt, to: round.finishedAt },
    );
    assert.ok(
      assertClaudeTranscriptModel(r, config) > 0,
      "No Claude model evidence",
    );
    assert.equal(
      realpathSync(r.cwd),
      realpathSync(cwd),
      "Actual CLI workspace changed",
    );
  } else if (config.provider === "kimi") {
    const r = kimiWireRound(readKimiWire(round.sessionId), {
      from: round.startedAt,
      to: round.finishedAt,
    });
    assertKimiRequests(r.requests, config);
  } else if (config.provider === "opencode") {
    assert.ok(
      assertOpenCodeAssistants(
        readOpenCodeRound(round.sessionId, lo, hi),
        config,
      ).assistants > 0,
      "No OpenCode model evidence",
    );
    assert.equal(
      realpathSync(openCodeSessionDirectory(round.sessionId)),
      realpathSync(cwd),
      "Actual CLI workspace changed",
    );
  } else fail(config.provider);
  round.actualIdentityVerified = true;
  // Non-Codex memory/cwd require separately checked actual launch evidence.
  if (config.provider === "codex") {
    round.actualMemoryOff = true;
    round.actualWorkspaceVerified = true;
  }
}
