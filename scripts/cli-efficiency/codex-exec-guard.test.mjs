import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { classifyCodexLaunch } from "./model-guard.mjs";
import { writeGuardedShim, assertNoGuardViolations } from "./guarded-shim.mjs";
import { providerLaunchSwitches } from "../../packages/agent-host/src/provider-launch-arguments.js";
const approved = {
  model: "gpt-6-luna",
  effort: "low",
  execTransport: "codex-exec/v1",
};
function args(session) {
  return [
    "exec",
    ...(session ? ["resume"] : []),
    ...providerLaunchSwitches("codex").args,
    "-c",
    'model_reasoning_effort="low"',
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--model",
    "gpt-6-luna",
    ...(session ? [session] : []),
    "-",
  ];
}
test("explicit exec transport admits original driver initial/resume and native no-prompt launch", () => {
  for (const session of [undefined, "original-session"]) {
    const a = args(session);
    const plan = classifyCodexLaunch(a, approved);
    assert.equal(plan.kind, "exec");
    assert.equal(plan.sessionId, session);
    assert.equal(
      classifyCodexLaunch(
        [
          ...a.slice(0, session ? -2 : -1),
          "-c",
          'developer_instructions="Channel prompt"',
          "--output-last-message",
          "/private/test/last-message",
          ...a.slice(session ? -2 : -1),
        ],
        approved,
      ).kind,
      "exec",
    );
  }
  assert.throws(() => classifyCodexLaunch(args()));
  assert.throws(() => classifyCodexLaunch(["app-server"], approved));
  assert.equal(
    classifyCodexLaunch(
      [
        "mcp",
        "list",
        "--json",
        ...providerLaunchSwitches("codex").args,
        "-c",
        "mcp_servers.user_tool.enabled=false",
      ],
      approved,
    ).kind,
    "mcp-list",
  );
});
test("every launch needs exact model/effort and complete memory/autonomy/isolation, no fallback", () => {
  const mutations = [
    (a) => a.splice(a.indexOf("--model") + 1, 1, "gpt-6-sol"),
    (a) => a.splice(a.indexOf("--model"), 2),
    (a) => a.splice(-1, 0, "--model", "gpt-6-luna"),
    (a) =>
      a.splice(
        a.indexOf('model_reasoning_effort="low"'),
        1,
        'model_reasoning_effort="high"',
      ),
    (a) => a.splice(-1, 0, "-c", 'model_reasoning_effort="low"'),
    (a) => a.splice(-1, 0, "--fallback-model", "gpt-6-sol"),
    (a) => a.splice(-1, 0, "--profile", "other"),
    (a) => a.splice(-1, 0, "-c", 'model_provider="other"'),
    (a) => a.splice(-1, 0, "--config", "features.memories=true"),
    (a) => a.splice(-1, 0, "--enable", "memories"),
    (a) => a.splice(-1, 0, "--output-schema", "/tmp/schema"),
    (a) => a.splice(-1, 0, "--last"),
    (a) => a.splice(-1, 0, "-c", 'developer_instructions="ok"\nmodel="other"'),
    (a) => a.splice(-1, 0, "--output-last-message", "relative"),
    (a) =>
      a.splice(
        -1,
        0,
        "--output-last-message",
        "/tmp/a",
        "--output-last-message",
        "/tmp/b",
      ),
    (a) => a.splice(-1, 0, "-c", "mcp_servers.extra.enabled=true"),
    (a) => a.splice(-1, 1, "arbitrary positional input"),
  ];
  for (const mutate of mutations) {
    const a = args();
    mutate(a);
    assert.throws(
      () => classifyCodexLaunch(a, approved),
      undefined,
      JSON.stringify(a),
    );
  }
  for (const config of providerLaunchSwitches("codex").args.filter(
    (x) => x !== "-c",
  )) {
    const a = args();
    a.splice(a.indexOf(config) - 1, 2);
    assert.throws(() => classifyCodexLaunch(a, approved), undefined, config);
  }
  for (const bad of ["--last", "../session", "session other"])
    assert.throws(() => classifyCodexLaunch(args(bad), approved));
  for (const options of [
    { ...approved, effort: "high" },
    { ...approved, model: "gpt-6-sol" },
    { ...approved, execTransport: "other" },
  ])
    assert.throws(() => classifyCodexLaunch(args(), options));
});
test("official guarded shim refuses invalid launch before fake CLI and preserves stdin/session without app-server", () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-exec-guard-"));
  try {
    const marker = join(dir, "launched"),
      fake = join(dir, "fake.mjs");
    writeFileSync(
      fake,
      `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2)));\nlet text='';for await(const b of process.stdin)text+=b;\nprocess.stdout.write(JSON.stringify({type:'thread.started',thread_id:process.env.FAKE_SESSION??'original-session'})+'\\n');process.stdout.write(JSON.stringify({type:'turn.started'})+'\\n');process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text}})+'\\n');process.stdout.write(JSON.stringify({type:'turn.completed',usage:{}})+'\\n');`,
      { mode: 0o700 },
    );
    const shim = writeGuardedShim({
      provider: "codex",
      path: join(dir, "shim"),
      realCli: fake,
      model: approved.model,
      effort: approved.effort,
      options: { execTransport: approved.execTransport },
    });
    const bad = args();
    bad[bad.indexOf("--model") + 1] = "gpt-6-sol";
    const denied = spawnSync(shim, bad, {
      input: "secret wake",
      encoding: "utf8",
    });
    assert.notEqual(denied.status, 0);
    assert.equal(existsSync(marker), false);
    const good = spawnSync(shim, args("original-session"), {
      input: "exact wake\nnext line",
      encoding: "utf8",
    });
    assert.equal(good.status, 0, good.stderr);
    assert.doesNotMatch(readFileSync(marker, "utf8"), /app-server/);
    assert.match(good.stdout, /exact wake\\nnext line/);
    assertNoGuardViolations(shim);
    const wrong = spawnSync(shim, args("original-session"), {
      input: "wake",
      env: { ...process.env, FAKE_SESSION: "replacement" },
      encoding: "utf8",
    });
    assert.notEqual(wrong.status, 0);
    assert.throws(() => assertNoGuardViolations(shim));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
