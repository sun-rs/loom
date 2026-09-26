import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Owner 2026-09-26: each native CLI learns the channel's attached
 * directories through its own mechanism. Real driver processes, FAKE CLIs
 * (no model): the fakes only record what the driver launched them with.
 */
const driver = (name: string) =>
  fileURLToPath(new URL(`../src/${name}`, import.meta.url));

const recordingCli = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const localToml = join(process.cwd(), ".kimi-code", "local.toml");
appendFileSync(process.env.FAKE_RECORD, JSON.stringify({
  kind: "spawn",
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  kimiLocalToml: existsSync(localToml) ? readFileSync(localToml, "utf8") : null,
}) + "\\n");
if (process.env.FAKE_EXIT_AFTER_SPAWN === "1") process.exit(1);
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    let frame;
    try { frame = JSON.parse(line); } catch { continue; }
    if (frame.method === "initialize") {
      process.stdout.write(JSON.stringify({ id: frame.id, result: { userAgent: "fake" } }) + "\\n");
    } else if (frame.method === "thread/start" || frame.method === "thread/resume") {
      appendFileSync(process.env.FAKE_RECORD, JSON.stringify({ kind: "request", method: frame.method, params: frame.params }) + "\\n");
      process.exit(3);
    }
  }
});
setTimeout(() => process.exit(2), 3000);
`;

async function runDriver(
  name: string,
  args: string[],
): Promise<{
  code: number | null;
  records: Record<string, unknown>[];
  stderr: string;
  directory: string;
}> {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "rah-attached-driver-")),
  );
  chmodSync(directory, 0o700);
  const executable = join(directory, "fake-cli.cjs");
  const record = join(directory, "record.jsonl");
  writeFileSync(executable, recordingCli, { mode: 0o700 });
  const child = spawn(
    process.execPath,
    [
      driver(name),
      "--executable",
      executable,
      "--tool-access-mode",
      "full_access",
      "--prompt",
      "FAKE standing prompt",
      ...args,
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        FAKE_RECORD: record,
        FAKE_EXIT_AFTER_SPAWN: name.startsWith("codex") ? "" : "1",
        RAH_RUN_ATTEMPT_ID: "run-1",
      },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdout!.resume();
  child.stdio[3]!.on("data", () => undefined);
  const timer = setTimeout(() => child.kill("SIGKILL"), 8_000);
  const code = await new Promise<number | null>((resolve) =>
    child.once("close", (exitCode) => resolve(exitCode)),
  );
  clearTimeout(timer);
  const records = existsSync(record)
    ? readFileSync(record, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
  return { code, records, stderr, directory };
}

const attached = [
  "--additional-dir",
  "/work/app",
  "--additional-dir",
  "/work/lib",
];

test("Claude cold and warm launch one --add-dir=<abs> per attached directory, none without", async () => {
  for (const [name, extra] of [
    ["claude-stream-json-driver.mjs", []],
    [
      "claude-warm-driver.mjs",
      ["--runtime-id", "runtime-1", "--host-generation", "gen-1"],
    ],
  ] as const) {
    const run = await runDriver(name, [...extra, ...attached]);
    try {
      const argv = run.records.find((r) => r.kind === "spawn")
        ?.argv as string[];
      assert.ok(argv, `${name} spawned the CLI: ${run.stderr}`);
      assert.deepEqual(
        argv.filter((a) => a.startsWith("--add-dir")),
        ["--add-dir=/work/app", "--add-dir=/work/lib"],
        name,
      );
    } finally {
      rmSync(run.directory, { recursive: true, force: true });
    }
    const bare = await runDriver(name, [...extra]);
    try {
      const argv = bare.records.find((r) => r.kind === "spawn")
        ?.argv as string[];
      assert.equal(
        argv.some((a) => a.startsWith("--add-dir")),
        false,
        name,
      );
    } finally {
      rmSync(bare.directory, { recursive: true, force: true });
    }
  }
});

test("a driver refuses a non-absolute attached directory before launching the CLI", async () => {
  for (const name of [
    "claude-stream-json-driver.mjs",
    "codex-app-server-driver.mjs",
    "kimi-acp-driver.mjs",
  ]) {
    const run = await runDriver(name, ["--additional-dir", "relative/dir"]);
    try {
      assert.notEqual(run.code, 0, name);
      assert.equal(run.records.length, 0, `${name} never launched the CLI`);
      assert.match(run.stderr, /additional-dir/u, name);
    } finally {
      rmSync(run.directory, { recursive: true, force: true });
    }
  }
});

test("Codex cold thread/start carries runtimeWorkspaceRoots = [cwd, ...attached]; omitted without attached directories", async () => {
  const run = await runDriver("codex-app-server-driver.mjs", attached);
  try {
    const start = run.records.find((r) => r.kind === "request") as
      { method: string; params: Record<string, unknown> } | undefined;
    assert.equal(start?.method, "thread/start", run.stderr);
    assert.deepEqual(start?.params.runtimeWorkspaceRoots, [
      run.directory,
      "/work/app",
      "/work/lib",
    ]);
  } finally {
    rmSync(run.directory, { recursive: true, force: true });
  }
  const resumed = await runDriver("codex-app-server-driver.mjs", [
    ...attached,
    "--resume-session",
    "thread-1",
  ]);
  try {
    const resume = resumed.records.find((r) => r.kind === "request") as
      { method: string; params: Record<string, unknown> } | undefined;
    assert.equal(resume?.method, "thread/resume");
    assert.deepEqual(resume?.params.runtimeWorkspaceRoots, [
      resumed.directory,
      "/work/app",
      "/work/lib",
    ]);
  } finally {
    rmSync(resumed.directory, { recursive: true, force: true });
  }
  const bare = await runDriver("codex-app-server-driver.mjs", []);
  try {
    const start = bare.records.find((r) => r.kind === "request") as
      { params: Record<string, unknown> } | undefined;
    assert.ok(start);
    assert.equal("runtimeWorkspaceRoots" in start.params, false);
  } finally {
    rmSync(bare.directory, { recursive: true, force: true });
  }
});

test("Kimi: the Host writes .kimi-code/local.toml [workspace] additional_dir in the cwd before launching kimi acp", async () => {
  const run = await runDriver("kimi-acp-driver.mjs", attached);
  try {
    const spawned = run.records.find((r) => r.kind === "spawn");
    assert.ok(spawned, run.stderr);
    const toml = spawned.kimiLocalToml as string;
    assert.match(toml, /^\[workspace\]$/mu);
    assert.match(toml, /^additional_dir = \["\/work\/app", "\/work\/lib"\]$/mu);
    const path = join(run.directory, ".kimi-code", "local.toml");
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(run.directory, { recursive: true, force: true });
  }
  const bare = await runDriver("kimi-acp-driver.mjs", []);
  try {
    const spawned = bare.records.find((r) => r.kind === "spawn");
    assert.ok(spawned);
    assert.equal(spawned.kimiLocalToml, null, "nothing written without dirs");
  } finally {
    rmSync(bare.directory, { recursive: true, force: true });
  }
});
