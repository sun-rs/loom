import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const driver = fileURLToPath(
  new URL("../src/agy-print-driver.mjs", import.meta.url),
);
const fake = fileURLToPath(
  new URL("./fixtures/fake-agy-print.mjs", import.meta.url),
);
function run(d, n, extra = [], env = {}) {
  const proof = join(d, `proof${n}`);
  const p = spawnSync(
    process.execPath,
    [
      driver,
      "--executable",
      fake,
      "--model",
      "model-low",
      "--reasoning",
      "low",
      "--prompt",
      "standing role",
      "--tool-access-mode",
      "full_access",
      "--launch-id",
      `l${n}`,
      "--final-proof-file",
      proof,
      "--native-final-text",
      ...extra,
    ],
    {
      input: "current wake",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      env: { ...process.env, AGY_FAKE_RECORD: join(d, "record"), ...env },
    },
  );
  return {
    p,
    proof,
    frames: (p.output[3] || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse),
  };
}
test("AGY resumes only explicit conversation, sends standing instructions once, and creates guarded final proof", () => {
  const d = mkdtempSync(join(tmpdir(), "agy-test-"));
  try {
    const a = run(d, 1);
    assert.equal(a.p.status, 0, a.p.stderr);
    assert.equal(JSON.parse(readFileSync(a.proof)).text, "完成中文😀");
    assert.equal(
      a.frames.filter((f) => f.protocol === "rah-provider-usage/v1").length,
      1,
    );
    assert.equal(
      a.frames.find((f) => f.protocol === "rah-provider-usage/v1").inputTokens,
      12,
    );
    const b = run(d, 2, ["--resume-session", "agy-session"]);
    assert.equal(b.p.status, 0, b.p.stderr);
    const args = readFileSync(join(d, "record"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.match(args[0][args[0].indexOf("-p") + 1], /standing role/);
    assert.equal(args[1][args[1].indexOf("-p") + 1], "current wake");
    assert.equal(args[1][args[1].indexOf("--conversation") + 1], "agy-session");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test("AGY failed, truncated and replaced sessions cannot publish even on exit zero", () => {
  for (const mode of ["failed", "truncated", "replace"]) {
    const d = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      const r = run(d, 1, ["--resume-session", "agy-session"], {
        AGY_FAKE_MODE: mode,
      });
      assert.notEqual(r.p.status, 0);
      assert.equal(existsSync(r.proof), false);
      assert.ok(
        r.frames.some((f) => f.protocol === "rah-provider-usage-gap/v1"),
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

test("AGY cancellation terminates the native child, retains usage, and creates no final proof", async () => {
  const { spawn } = await import("node:child_process");
  const d = mkdtempSync(join(tmpdir(), "agy-stop-"));
  try {
    const proof = join(d, "proof");
    const p = spawn(
      process.execPath,
      [
        driver,
        "--executable",
        fake,
        "--model",
        "model-low",
        "--reasoning",
        "low",
        "--tool-access-mode",
        "full_access",
        "--launch-id",
        "cancel",
        "--final-proof-file",
        proof,
        "--native-final-text",
      ],
      {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        env: { ...process.env, AGY_FAKE_MODE: "hang" },
      },
    );
    const closed = new Promise((resolve) =>
      p.once("close", (code, signal) => resolve({ code, signal })),
    );
    p.stdin.end("wake");
    p.stdout.resume();
    p.stderr.resume();
    let protocol = "";
    const observed = new Promise((resolve) =>
      p.stdio[3].on("data", (b) => {
        protocol += b;
        if (protocol.includes("rah-provider-usage/v1")) resolve();
      }),
    );
    await Promise.race([
      observed,
      new Promise((_, reject) => {
        const t = setTimeout(() => {
          p.kill("SIGKILL");
          reject(Error("no usage"));
        }, 5000);
        t.unref();
      }),
    ]);
    p.kill("SIGTERM");
    const exit = await closed;
    assert.notEqual(exit.code, 0);
    assert.equal(existsSync(proof), false);
    assert.match(protocol, /rah-provider-usage\/v1/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("AGY forwards only the host-owned attached directories on resumed launches", () => {
  const d = mkdtempSync(join(tmpdir(), "agy-dirs-"));
  try {
    const r = run(d, 1, [
      "--resume-session",
      "agy-session",
      "--add-dir",
      "/attached one",
      "--add-dir",
      "/attached-two",
    ]);
    assert.equal(r.p.status, 0, r.p.stderr);
    const args = JSON.parse(readFileSync(join(d, "record"), "utf8").trim());
    assert.deepEqual(
      args.flatMap((a, i) => (a === "--add-dir" ? [args[i + 1]] : [])),
      ["/attached one", "/attached-two"],
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
