import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const driver = fileURLToPath(
  new URL("../src/codex-exec-driver.mjs", import.meta.url),
);
const fixture = fileURLToPath(
  new URL("./fixtures/fake-codex-exec.mjs", import.meta.url),
);
function setup() {
  const root = mkdtempSync(join(tmpdir(), "loom-exec-driver-test-"));
  const executable = join(root, "codex");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)} "$@"\n`,
    { mode: 0o700 },
  );
  mkdirSync(join(root, "home"));
  const record = join(root, "record.jsonl");
  return {
    root,
    record,
    async run(
      wake: string,
      session?: string,
      extra: string[] = [],
      onSpawn?: (p: ChildProcess) => void,
      environment: Record<string, string> = {},
    ) {
      const launchId = `launch-${Math.random()}`,
        proof = join(root, launchId + ".json"),
        input = join(root, launchId + ".txt");
      writeFileSync(input, wake, { mode: 0o600 });
      const p = spawn(
        process.execPath,
        [
          driver,
          "--executable",
          executable,
          "--tool-access-mode",
          "full_access",
          "--prompt",
          "Standing protocol",
          "--model",
          "fake-model",
          "--reasoning",
          "low",
          "--wake-input-file",
          input,
          "--launch-id",
          launchId,
          "--final-proof-file",
          proof,
          "--native-final-text",
          ...(session ? ["--resume-session", session] : []),
          ...extra,
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            CODEX_HOME: join(root, "home"),
            FAKE_CODEX_EXEC_RECORD_PATH: record,
            ...environment,
          },
          stdio: ["ignore", "pipe", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "",
        control = "";
      p.stdout!.on("data", (b) => (out += b));
      p.stderr!.on("data", (b) => (err += b));
      p.stdio[3]!.on("data", (b) => (control += b));
      onSpawn?.(p);
      const code = await new Promise((r) => p.on("close", r));
      return {
        code,
        out,
        err,
        proof,
        launchId,
        frames: control
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((x) => JSON.parse(x)),
      };
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("ordinary exec then exact resume preserve session and prove current input/final; never app-server", async () => {
  const h = setup();
  try {
    const first = await h.run("First wake");
    assert.equal(first.code, 0, first.err);
    const a = JSON.parse(readFileSync(first.proof, "utf8"));
    const second = await h.run("Second wake", a.sessionId);
    assert.equal(second.code, 0, second.err);
    const b = JSON.parse(readFileSync(second.proof, "utf8"));
    assert.equal(a.sessionId, b.sessionId);
    assert.notEqual(a.turnId, b.turnId);
    assert.notEqual(a.launchId, b.launchId);
    assert.equal(a.text, "FAKE ORDINARY CODEX ANSWER 1");
    assert.equal(b.text, "FAKE ORDINARY CODEX ANSWER 2");
    for (const r of [first, second]) {
      assert.equal(
        r.frames.filter((f) => f.protocol === "rah-provider-session/v1").length,
        1,
      );
      assert.equal(
        r.frames.filter((f) => f.protocol === "rah-delivery-accepted/v1")
          .length,
        1,
      );
      assert.ok(
        r.frames.some(
          (f) =>
            f.protocol === "rah-provider-usage/v1" ||
            f.protocol === "rah-provider-usage-gap/v1",
        ),
      );
    }
    const records = readFileSync(h.record, "utf8");
    assert.doesNotMatch(records, /app-server/);
    assert.match(records, /features.memories=false/);
    assert.match(records, /developer_instructions=/);
  } finally {
    h.close();
  }
});
test("missing final retains session/input evidence and native exit without manufacturing proof", async () => {
  const h = setup();
  try {
    const r = await h.run("[fake:missing-final]");
    assert.equal(r.code, 0, r.err);
    assert.equal(existsSync(r.proof), false);
    assert.ok(r.frames.some((f) => f.protocol === "rah-provider-session/v1"));
    assert.ok(r.frames.some((f) => f.protocol === "rah-delivery-accepted/v1"));
  } finally {
    h.close();
  }
});
test("wrong resumed session never publishes evidence or silently starts replacement", async () => {
  const h = setup();
  try {
    const a = await h.run("first");
    assert.equal(a.code, 0, a.err);
    const session = JSON.parse(readFileSync(a.proof, "utf8")).sessionId;
    const r = await h.run("[fake:wrong-session]", session);
    assert.equal(existsSync(r.proof), false);
    assert.equal(
      r.frames.filter((f) => f.protocol === "rah-provider-session/v1").length,
      0,
    );
    assert.equal(
      r.frames.filter((f) => f.protocol === "rah-delivery-accepted/v1").length,
      0,
    );
  } finally {
    h.close();
  }
});
test("missing bound rollout and unverified attached directory refuse before any provider invocation", async () => {
  const h = setup();
  try {
    const missing = await h.run("wake", "missing-session");
    assert.notEqual(missing.code, 0);
    assert.match(missing.err, /SESSION_CONTINUITY_REQUIRED/);
    assert.ok(
      missing.frames.some(
        (f) =>
          f.entry?.activity === "error" &&
          f.entry?.detail?.includes("RAH_SESSION_CONTINUITY_REQUIRED"),
      ),
      "Host receives continuity failure through fd3",
    );
    assert.equal(existsSync(h.record), false);
    const directory = await h.run("wake", undefined, [
      "--additional-dir",
      h.root,
    ]);
    assert.notEqual(directory.code, 0);
    assert.match(
      directory.err,
      /attached-directory support has not been verified/,
    );
    assert.equal(existsSync(h.record), false);
  } finally {
    h.close();
  }
});

test("ordinary exec cancellation keeps session evidence, leaves no final proof or temporary output", async () => {
  const h = setup();
  try {
    const r = await h.run("[fake:hang]", undefined, [], (p) => {
      p.stdio[3]!.once("data", () => p.kill("SIGTERM"));
    });
    assert.equal(r.code, 143, r.err);
    assert.ok(r.frames.some((f) => f.protocol === "rah-provider-session/v1"));
    assert.equal(existsSync(r.proof), false);
    assert.equal(
      readdirSync(h.root).some((n) => n.startsWith("exec-final-")),
      false,
    );
  } finally {
    h.close();
  }
});

test("app-server launch overrides are refused, never silently repurposed for exec", async () => {
  const h = setup();
  try {
    const r = await h.run("wake", undefined, [], undefined, {
      RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
        runtimeId: "codex",
        overrideArgs: ["app-server"],
      }),
    });
    assert.notEqual(r.code, 0);
    assert.match(r.err, /override.*ordinary exec/);
    assert.equal(existsSync(h.record), false);
  } finally {
    h.close();
  }
});

test("per-response usage uses only current suffix, and invalid accounting cannot hide a proven final", async () => {
  const h = setup();
  try {
    const first = await h.run("first");
    assert.equal(first.code, 0, first.err);
    const session = JSON.parse(readFileSync(first.proof, "utf8")).sessionId;
    const second = await h.run("second", session);
    assert.equal(second.code, 0, second.err);
    assert.equal(
      second.frames.filter((f) => f.protocol === "rah-provider-usage/v1")
        .length,
      1,
    );
    assert.deepEqual(
      second.frames
        .filter((f) => f.protocol === "rah-provider-usage/v1")
        .map((f) => [f.inputTokens, f.outputTokens]),
      [[100, 10]],
    );
    const bad = await h.run("[fake:bad-usage]", session);
    assert.equal(bad.code, 0, bad.err);
    assert.ok(
      existsSync(bad.proof),
      "valid publication evidence remains independent from bad accounting",
    );
    assert.equal(
      bad.frames.filter((f) => f.protocol === "rah-provider-usage/v1").length,
      0,
    );
    assert.ok(
      bad.frames.some((f) => f.protocol === "rah-provider-usage-gap/v1"),
    );
  } finally {
    h.close();
  }
});

for (const conflict of [false, true])
  test(`per-response duplicate accounting ignores capture timestamp; conflict=${String(conflict)}`, async () => {
    const h = setup();
    try {
      const r = await h.run(
        conflict ? "[fake:conflicting-usage]" : "[fake:duplicate-usage]",
      );
      assert.equal(r.code, 0, r.err);
      assert.ok(existsSync(r.proof));
      const rows = r.frames.filter(
          (f) => f.protocol === "rah-provider-usage/v1",
        ),
        gaps = r.frames.filter(
          (f) => f.protocol === "rah-provider-usage-gap/v1",
        );
      assert.equal(rows.length, conflict ? 0 : 1);
      assert.equal(gaps.length, conflict ? 1 : 0);
    } finally {
      h.close();
    }
  });

test("daemon default null launch override supports initial and resumed ordinary exec", async () => {
  const h = setup();
  const environment = {
    RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
      runtimeId: "codex",
      overrideArgs: null,
      additionalArgs: [],
    }),
  };
  try {
    const first = await h.run(
      "Daemon first wake",
      undefined,
      [],
      undefined,
      environment,
    );
    assert.equal(first.code, 0, first.err);
    const session = JSON.parse(readFileSync(first.proof, "utf8")).sessionId;
    const second = await h.run(
      "Daemon resumed wake",
      session,
      [],
      undefined,
      environment,
    );
    assert.equal(second.code, 0, second.err);
    assert.equal(
      JSON.parse(readFileSync(second.proof, "utf8")).sessionId,
      session,
    );
  } finally {
    h.close();
  }
});

test("real launch overrides and additions remain rejected before provider launch", async () => {
  for (const options of [
    { overrideArgs: [] },
    { overrideArgs: ["app-server"] },
    { overrideArgs: "exec" },
    { overrideArgs: null, additionalArgs: ["--extra"] },
  ]) {
    const h = setup();
    try {
      const result = await h.run("must not run", undefined, [], undefined, {
        RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
          runtimeId: "codex",
          ...options,
        }),
      });
      assert.notEqual(result.code, 0);
      assert.match(result.err, /launch override/);
      assert.equal(existsSync(h.record), false);
    } finally {
      h.close();
    }
  }
});
