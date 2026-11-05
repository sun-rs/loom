import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  createFixture,
  isolatedEnvironment,
} from "../herdr-runtime-study/fixture.mjs";
import { JsonLinesProcess } from "./stdio.mjs";
assert(process.argv.includes("--run-free"), "Explicit --run-free required");
const root = mkdtempSync("/tmp/lh-rpc-kimi-");
for (const dir of ["home", "kimi", "work"]) mkdirSync(root + "/" + dir);
const env = {
  ...isolatedEnvironment(root),
  KIMI_CODE_HOME: root + "/kimi",
  KIMI_DISABLE_TELEMETRY: "1",
};
const fixture = await createFixture({
  models: ["fixture", "fixture-alt"],
  readTool: { name: "Read", arguments: { path: root + "/work/probe.txt" } },
});
const save = (name, data) =>
  writeFileSync(root + "/" + name, JSON.stringify(data, null, 2));
writeFileSync(root + "/work/probe.txt", fixture.marker);
writeFileSync(
  root + "/kimi/config.toml",
  `default_model="fixture"\ndefault_permission_mode="auto"\nmerge_all_available_skills=false\nbuiltin_product_skills=false\ntelemetry=false\n[providers.local]\ntype="openai"\nbase_url="${fixture.origin}/v1"\napi_key="fixture-only"\n` +
    ["fixture", "fixture-alt"]
      .map(
        (id) =>
          `[models.${JSON.stringify(id)}]\nprovider="local"\nmodel=${JSON.stringify(id)}\nmax_context_size=32000\ncapabilities=["tool_use","thinking"]\nsupport_efforts=["low","high"]\ndefault_effort="low"\n`,
      )
      .join("") +
    '[thinking]\nenabled=true\neffort="low"\n[loop_control]\nmax_attempts_per_step=1\nreserved_context_size=1000\n',
);
const result = {
  root,
  kind: "native-kimi-persistent-acp-probe",
  paidCalls: 0,
  checks: [],
  startedAt: new Date().toISOString(),
};
const children = [];
let child, sessionId;
const ok = (id, data = {}) => {
  result.checks.push({ id, ...data });
  console.log(JSON.stringify({ check: id, ...data }));
};
const value = (r) => {
  assert(!r.error, JSON.stringify(r));
  return r.result;
};
async function start() {
  child = new JsonLinesProcess("/opt/homebrew/bin/kimi", ["acp"], {
    env,
    cwd: root + "/work",
  });
  children.push(child);
  const info = value(
    await child.rpc("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "loom-runtime-audit", version: "1" },
      clientCapabilities: {},
    }),
  );
  result.initialize = info;
  return info;
}
async function ask(text) {
  const count = fixture.requests.length,
    at = child.frames.length;
  const reply = value(
    await child.rpc(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text }] },
      30000,
    ),
  );
  assert.equal(reply.stopReason, "end_turn");
  assert.equal(fixture.requests.length - count, 2);
  const textOut = child.frames
    .slice(at)
    .filter(
      (x) =>
        x.method === "session/update" &&
        x.params?.sessionId === sessionId &&
        x.params.update?.sessionUpdate === "agent_message_chunk",
    )
    .map((x) => x.params.update.content?.text ?? "")
    .join("");
  assert.equal(textOut, "Fixture task completed.");
}
try {
  console.log(JSON.stringify({ root, paidCalls: 0 }));
  await start();
  const session = value(
    await child.rpc("session/new", { cwd: root + "/work", mcpServers: [] }),
  );
  sessionId = session.sessionId;
  result.nativeSessionId = sessionId;
  result.pid = child.process.pid;
  result.session = session;
  ok("initialize-create-session", {
    sessionId,
    capabilities: result.initialize.agentCapabilities,
  });
  for (let n = 0; n < 2; n++) {
    await ask("Use Read to read probe.txt, then finish.");
    assert.equal(child.process.pid, result.pid);
    ok("continuous-native-turn", {
      turn: n + 1,
      sessionId,
      pid: child.process.pid,
    });
  }
  const count = fixture.requests.length;
  value(
    await child.rpc("session/set_model", { sessionId, modelId: "fixture-alt" }),
  );
  const effort = value(
    await child.rpc("session/set_config_option", {
      sessionId,
      configId: "thinking",
      value: "high",
    }),
  );
  assert(
    effort.configOptions.some(
      (x) => x.id === "thinking" && x.currentValue === "high",
    ),
  );
  assert.equal(fixture.requests.length, count);
  await ask("Use Read to read probe.txt, then finish.");
  assert(
    fixture.requests.slice(count).every((x) => x.body.model === "fixture-alt"),
  );
  ok("model-and-effort-change-in-same-session", {
    sessionId,
    model: "fixture-alt",
    effort: "high",
  });
  const before = fixture.requests.length;
  const pending = child.rpc(
    "session/prompt",
    {
      sessionId,
      prompt: [
        {
          type: "text",
          text: "SLOW: Use Read to read probe.txt, then finish.",
        },
      ],
    },
    30000,
  );
  const deadline = Date.now() + 15000;
  while (fixture.requests.length < before + 2) {
    assert(Date.now() < deadline);
    await delay(5);
  }
  child.send({
    jsonrpc: "2.0",
    method: "session/cancel",
    params: { sessionId },
  });
  const cancelled = value(await pending);
  assert.equal(cancelled.stopReason, "cancelled");
  ok("native-cancel", { stopReason: cancelled.stopReason });
  await ask("Use Read to read probe.txt, then finish.");
  ok("next-turn-after-cancel");
  const bad = await child.rpc("session/set_model", {
    sessionId,
    modelId: "not-published",
  });
  assert(bad.error);
  ok("unknown-model-rejected");
  const exit = await child.close({ graceMs: 35000 });
  assert.equal(exit.code, 0);
  await start();
  const resumed = value(
    await child.rpc("session/resume", {
      sessionId,
      cwd: root + "/work",
      mcpServers: [],
    }),
  );
  // ACP resume returns configuration, not a newly allocated sessionId.
  if (resumed.sessionId !== undefined)
    assert.equal(resumed.sessionId, sessionId);
  assert(
    resumed.configOptions.some(
      (x) => x.id === "model" && x.currentValue === "fixture-alt",
    ),
  );
  assert(
    resumed.configOptions.some(
      (x) => x.id === "thinking" && x.currentValue === "high",
    ),
  );
  const listed = value(await child.rpc("session/list", {}));
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.sessions[0].sessionId, sessionId);
  await ask("Use Read to read probe.txt, then finish.");
  ok("process-restart-resumes-exact-session", { sessionId });
  result.status = "passed-native-probe-not-product-integration";
} catch (e) {
  result.status = "failed";
  result.error = String(e);
  result.stack = e.stack;
  console.error(String(e));
  process.exitCode = 1;
} finally {
  result.exits = [];
  for (const c of children) {
    result.exits.push(await c.close({ graceMs: 35000 }));
    save("frames-" + children.indexOf(c) + ".json", c.frames);
    writeFileSync(root + "/stderr-" + children.indexOf(c), c.stderr);
  }
  save("fixture.json", {
    requests: fixture.requests,
    receipts: fixture.receipts,
    errors: fixture.errors,
    traffic: fixture.traffic,
  });
  result.requests = fixture.requests.length;
  result.fileReadReceipts = fixture.receipts.length;
  await fixture.close();
  result.finishedAt = new Date().toISOString();
  save("result.json", result);
  console.log(
    JSON.stringify({
      root,
      status: result.status,
      checks: result.checks.length,
      requests: result.requests,
      error: result.error,
    }),
  );
}
