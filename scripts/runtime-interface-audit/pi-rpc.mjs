import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  createFixture,
  isolatedEnvironment,
} from "../herdr-runtime-study/fixture.mjs";
import { JsonLinesProcess } from "./stdio.mjs";
assert(process.argv.includes("--run-free"), "Explicit --run-free required");
const root = mkdtempSync("/tmp/lh-rpc-pi-");
for (const dir of ["home", "pi", "work"]) mkdirSync(root + "/" + dir);
const env = isolatedEnvironment(root),
  fixture = await createFixture({ models: ["fixture", "fixture-alt"] });
const save = (name, data) =>
  writeFileSync(root + "/" + name, JSON.stringify(data, null, 2));
writeFileSync(root + "/work/probe.txt", fixture.marker);
writeFileSync(
  root + "/pi/models.json",
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: fixture.origin + "/v1",
        api: "openai-completions",
        apiKey: "fixture-only",
        models: ["fixture", "fixture-alt"].map((id) => ({
          id,
          reasoning: false,
          input: ["text"],
          contextWindow: 32000,
          maxTokens: 2048,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      },
    },
  }),
);
writeFileSync(
  root + "/pi/settings.json",
  JSON.stringify({
    quietStartup: true,
    compaction: { enabled: false },
    retry: { enabled: false, maxRetries: 0 },
  }),
);
const args = [
  "--mode",
  "rpc",
  "--offline",
  "--no-context-files",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-mcp",
  "--no-themes",
  "--provider",
  "fixture",
  "--model",
  "fixture",
  "--thinking",
  "off",
  "--tools",
  "read",
  "--session",
  root + "/session.jsonl",
];
const result = {
  root,
  kind: "native-pi-rpc-control-probe",
  paidCalls: 0,
  checks: [],
  startedAt: new Date().toISOString(),
  args,
};
const children = [];
let child;
const start = (resume = false) => {
  // Explicit --model wins over the model persisted by native set_model.
  // This probe tests native restoration, so only the initial launch pins it.
  const launch = resume
    ? args.filter(
        (x, i) =>
          !["--provider", "--model"].includes(x) &&
          !["--provider", "--model"].includes(args[i - 1]),
      )
    : args;
  child = new JsonLinesProcess("/opt/homebrew/bin/pi", launch, {
    env,
    cwd: root + "/work",
  });
  children.push(child);
  return child;
};
const ok = (id, data = {}) => {
  result.checks.push({ id, ...data });
  console.log(JSON.stringify({ check: id, ...data }));
};
const requireSuccess = (r) => {
  assert.equal(r.success, true, JSON.stringify(r));
  return r.data;
};
async function ask(text) {
  const after = child.frames.length,
    before = fixture.requests.length;
  requireSuccess(await child.pi("prompt", { message: text }));
  await child.wait((x) => x.type === "agent_settled", { after });
  const state = requireSuccess(await child.pi("get_state"));
  assert.equal(state.isStreaming, false);
  const messages = requireSuccess(await child.pi("get_messages")).messages;
  assert.equal(messages.at(-1).stopReason, "stop");
  assert.equal(
    messages.at(-1).content.find((x) => x.type === "text").text,
    "Fixture task completed.",
  );
  assert.equal(fixture.requests.length - before, 2);
  return state;
}
try {
  console.log(JSON.stringify({ root, paidCalls: 0 }));
  start();
  const state = requireSuccess(await child.pi("get_state"));
  result.nativeSessionId = state.sessionId;
  result.pid = child.process.pid;
  assert.equal(fixture.requests.length, 0);
  ok("state-and-model-discovery", {
    sessionId: state.sessionId,
    models: requireSuccess(await child.pi("get_available_models")).models.map(
      (x) => x.id,
    ),
  });
  for (let n = 0; n < 2; n++) {
    const s = await ask("Read probe.txt using read, then finish.");
    assert.equal(s.sessionId, result.nativeSessionId);
    assert.equal(child.process.pid, result.pid);
    ok("continuous-native-turn", {
      turn: n + 1,
      sessionId: s.sessionId,
      pid: child.process.pid,
    });
  }
  const before = fixture.requests.length;
  requireSuccess(
    await child.pi("set_model", {
      provider: "fixture",
      modelId: "fixture-alt",
    }),
  );
  requireSuccess(await child.pi("set_thinking_level", { level: "off" }));
  assert.equal(fixture.requests.length, before);
  const switched = await ask("Read probe.txt using read, then finish.");
  assert.equal(switched.model.id, "fixture-alt");
  assert.equal(switched.sessionId, result.nativeSessionId);
  assert(
    fixture.requests.slice(before).every((x) => x.body.model === "fixture-alt"),
  );
  ok("model-change-without-process-or-session-replacement", {
    model: switched.model.id,
    controlRequests: 0,
  });
  const at = child.frames.length,
    count = fixture.requests.length;
  requireSuccess(
    await child.pi("prompt", {
      message: "SLOW: Read probe.txt using read, then finish.",
    }),
  );
  const deadline = Date.now() + 10000;
  while (fixture.requests.length < count + 2) {
    assert(Date.now() < deadline);
    await delay(5);
  }
  requireSuccess(await child.pi("abort"));
  await child.wait((x) => x.type === "agent_settled", { after: at });
  const stopped = requireSuccess(await child.pi("get_messages")).messages.at(
    -1,
  );
  assert.equal(stopped.stopReason, "aborted");
  assert.equal(requireSuccess(await child.pi("get_state")).isStreaming, false);
  ok("native-abort-settled", { stopReason: stopped.stopReason });
  await ask("Read probe.txt using read, then finish.");
  ok("next-turn-after-abort");
  const bad = await child.pi("set_model", {
    provider: "fixture",
    modelId: "not-published",
  });
  assert.equal(bad.success, false);
  assert.equal(
    requireSuccess(await child.pi("get_state")).model.id,
    "fixture-alt",
  );
  ok("unknown-model-rejected-without-fallback");
  const exit = await child.close();
  assert.equal(exit.code, 0);
  start(true);
  const resumed = requireSuccess(await child.pi("get_state"));
  assert.equal(resumed.sessionId, result.nativeSessionId);
  assert.equal(resumed.model.id, "fixture-alt");
  assert(resumed.messageCount > 0);
  await ask("Read probe.txt using read, then finish.");
  ok("process-restart-resumes-exact-session", { sessionId: resumed.sessionId });
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
    result.exits.push(await c.close());
    save("frames-" + children.indexOf(c) + ".json", c.frames);
    writeFileSync(root + "/stderr-" + children.indexOf(c), c.stderr);
  }
  save("fixture.json", {
    requests: fixture.requests,
    receipts: fixture.receipts,
    errors: fixture.errors,
  });
  result.requests = fixture.requests.length;
  result.fileReadReceipts = fixture.receipts.length;
  result.nativeHeader = readFileSync(root + "/session.jsonl", "utf8").split(
    "\n",
  )[0];
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
