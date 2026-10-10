import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const driver = fileURLToPath(
    new URL("../src/pi-print-driver.mjs", import.meta.url),
  ),
  fake = fileURLToPath(
    new URL("./fixtures/fake-pi-print.mjs", import.meta.url),
  );
function run(d, round, wake, extra = [], env = {}) {
  const proof = join(d, "proof-" + round);
  const p = spawnSync(
    process.execPath,
    [
      driver,
      "--executable",
      fake,
      "--prompt",
      "literal-file-name",
      "--model",
      "fake-local/fake-final",
      "--reasoning",
      "low",
      "--session-file",
      join(d, "session.jsonl"),
      "--launch-id",
      "launch-" + round,
      "--final-proof-file",
      proof,
      "--tool-access-mode",
      "full_access",
      ...extra,
    ],
    {
      input: wake,
      encoding: "utf8",
      env: { ...process.env, PI_FAKE_RECORD: join(d, "record"), ...env },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    },
  );
  return {
    p,
    proof,
    frames: (p.output[3] ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse),
  };
}
test("ordinary Pi driver retains session, proves input, and default mode does not auto-publish", () => {
  const d = mkdtempSync(join(tmpdir(), "pi-driver-"));
  try {
    writeFileSync(join(d, "literal-file-name"), "secret");
    const a = run(d, 1, "wake");
    assert.equal(a.p.status, 0, a.p.stderr);
    assert.equal(
      a.frames.filter((f) => f.protocol === "rah-delivery-accepted/v1").length,
      1,
    );
    assert.equal(existsSync(a.proof), false);
    const b = run(d, 2, "wake2", [
      "--resume-session",
      "pi-session",
      "--native-final-text",
    ]);
    assert.equal(b.p.status, 0, b.p.stderr);
    assert.equal(JSON.parse(readFileSync(b.proof)).text, "done");
    const launches = readFileSync(join(d, "record"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    for (const launch of launches) {
      assert.ok(
        launch.args.includes("--print"),
        "ordinary Pi must use print transport",
      );
      assert.equal(launch.args[launch.args.indexOf("--mode") + 1], "json");
    }
    assert.equal(launches[0].wake, "wake");
    assert.match(
      launches[0].args[launches[0].args.indexOf("--append-system-prompt") + 1],
      /^\[Loom standing instructions\]\n/,
    );
    assert.equal(launches[0].args.includes("rpc"), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test("Pi failed model result keeps known usage but cannot create native proof", () => {
  const d = mkdtempSync(join(tmpdir(), "pi-driver-"));
  try {
    const r = run(d, 1, "failed", ["--native-final-text"]);
    assert.equal(r.p.status, 0, r.p.stderr);
    assert.equal(existsSync(r.proof), false);
    assert.equal(
      r.frames.filter((f) => f.protocol === "rah-provider-usage/v1").length,
      1,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("Pi rejects launch overrides before executable starts", () => {
  const d = mkdtempSync(join(tmpdir(), "pi-driver-"));
  try {
    const r = run(d, 1, "wake", [], {
      RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
        runtimeId: "pi",
        additionalArgs: ["-e", "untrusted"],
      }),
    });
    assert.equal(r.p.status, 1);
    assert.match(r.p.stderr, /override.*not.*supported/i);
    assert.equal(existsSync(join(d, "record")), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("Pi decodes split multibyte native text without corrupting proof", () => {
  const d = mkdtempSync(join(tmpdir(), "pi-driver-"));
  try {
    const r = run(d, 1, "unicode", ["--native-final-text"]);
    assert.equal(r.p.status, 0, r.p.stderr);
    assert.equal(JSON.parse(readFileSync(r.proof)).text, "完成中文😀");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test("Pi emits completed generation usage before later process termination", async () => {
  const d = mkdtempSync(join(tmpdir(), "pi-driver-"));
  const p = spawn(
    process.execPath,
    [
      driver,
      "--executable",
      fake,
      "--prompt",
      "standing",
      "--model",
      "fake-local/fake-final",
      "--reasoning",
      "low",
      "--session-file",
      join(d, "session.jsonl"),
      "--launch-id",
      "launch",
      "--final-proof-file",
      join(d, "proof"),
      "--tool-access-mode",
      "full_access",
    ],
    { detached: true, stdio: ["pipe", "ignore", "ignore", "pipe"] },
  );
  const done = new Promise((r) => p.once("close", r));
  let seen = false,
    buffer = "";
  const timeout = setTimeout(() => {
    try {
      process.kill(-p.pid, "SIGKILL");
    } catch {}
  }, 5000);
  p.stdio[3].on("data", (b) => {
    buffer += b;
    if (buffer.includes("rah-provider-usage/v1")) {
      seen = true;
      process.kill(-p.pid, "SIGKILL");
    }
  });
  p.stdin.end("hang compact");
  try {
    await done;
    assert.equal(seen, true);
    assert.ok(
      buffer.includes("rah-provider-usage-gap/v1"),
      "compaction gap must precede later termination",
    );
    assert.equal(existsSync(join(d, "proof")), false);
  } finally {
    clearTimeout(timeout);
    try {
      process.kill(-p.pid, "SIGKILL");
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

test("Pi unfinished second generation keeps first known usage and records coverage gap", () => {
  const d = mkdtempSync(join(tmpdir(), "pi-driver-"));
  try {
    const r = run(d, 1, "partial", ["--native-final-text"]);
    assert.equal(r.p.status, 0, r.p.stderr);
    assert.equal(existsSync(r.proof), false);
    assert.equal(
      r.frames.filter((f) => f.protocol === "rah-provider-usage/v1").length,
      1,
    );
    assert.ok(r.frames.some((f) => f.protocol === "rah-provider-usage-gap/v1"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

for (const mode of [
  "compact",
  "compact start-only",
  "compact end-only",
  "compact suffix-only",
  "post-final compact",
]) {
  test(`Pi ${mode} marks usage partial without replacing native final or known generations`, () => {
    const d = mkdtempSync(join(tmpdir(), "pi-driver-"));
    try {
      const first = run(d, 1, mode, ["--native-final-text"]);
      assert.equal(first.p.status, 0, first.p.stderr);
      assert.equal(JSON.parse(readFileSync(first.proof)).text, "done");
      const known = first.frames.filter(
        (f) => f.protocol === "rah-provider-usage/v1",
      );
      assert.equal(known.length, 1);
      assert.equal(known[0].inputTokens, 10);
      assert.equal(known[0].outputTokens, 2);
      assert.equal(
        first.frames.filter(
          (f) =>
            f.protocol === "rah-provider-usage-gap/v1" &&
            f.reason === "parse_error",
        ).length,
        1,
        "only the compaction coverage gap, not a false unfinished-stream gap",
      );
      assert.equal(
        first.frames.filter((f) => f.protocol === "rah-delivery-accepted/v1")
          .length,
        1,
      );
      const resumed = run(d, 2, "ordinary resumed wake", [
        "--resume-session",
        "pi-session",
        "--native-final-text",
      ]);
      assert.equal(resumed.p.status, 0, resumed.p.stderr);
      assert.equal(JSON.parse(readFileSync(resumed.proof)).text, "done");
      assert.equal(
        resumed.frames.filter((f) => f.protocol === "rah-provider-usage-gap/v1")
          .length,
        0,
        "old compaction must not pollute resumed turn",
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
}
