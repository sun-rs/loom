import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { writeKimiWorkspaceConfig } from "../src/channel-attached-directories.js";

/**
 * Review 2026-09-26 P1-2: Kimi `.kimi-code/local.toml` is created only when
 * absent and updated only while it is still the unmodified Loom-managed
 * version; any other existing file is kept and the launch fails with a
 * diagnosable code. Temporary directories only, no Kimi process.
 */
const dirs = ["/work/app", "/work/lib"];
function cwdFor(t: TestContext) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "rah-kimi-config-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
const configPath = (cwd: string) => join(cwd, ".kimi-code", "local.toml");
function writeExisting(cwd: string, text: string) {
  mkdirSync(join(cwd, ".kimi-code"), { recursive: true });
  writeFileSync(configPath(cwd), text);
}
function assertCode(fn: () => void, code: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code?: string }).code, code);
    assert.match(error.message, new RegExp(code, "u"));
    return true;
  });
}

test("creates local.toml when absent and leaves an unchanged platform file untouched on the next start", (t) => {
  const cwd = cwdFor(t);
  writeKimiWorkspaceConfig(cwd, dirs);
  const text = readFileSync(configPath(cwd), "utf8");
  assert.match(text, /^# Managed by Loom/u);
  assert.match(text, /^additional_dir = \["\/work\/app", "\/work\/lib"\]$/mu);
  const before = statSync(configPath(cwd));
  assert.equal(before.mode & 0o777, 0o600);
  writeKimiWorkspaceConfig(cwd, dirs);
  const after = statSync(configPath(cwd));
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(readFileSync(configPath(cwd), "utf8"), text);
});

test("an existing user file is kept and the launch fails with KIMI_LOCAL_CONFIG_FOREIGN", (t) => {
  const cwd = cwdFor(t);
  const user = "# user setting\n[custom]\nvalue = 42\n";
  writeExisting(cwd, user);
  assertCode(
    () => writeKimiWorkspaceConfig(cwd, dirs),
    "KIMI_LOCAL_CONFIG_FOREIGN",
  );
  assert.equal(readFileSync(configPath(cwd), "utf8"), user);
});

test("a Loom-managed file that was edited is kept and the launch fails with KIMI_LOCAL_CONFIG_MODIFIED", (t) => {
  const cwd = cwdFor(t);
  writeKimiWorkspaceConfig(cwd, dirs);
  const edited = `${readFileSync(configPath(cwd), "utf8")}[custom]\nvalue = 42\n`;
  writeFileSync(configPath(cwd), edited);
  assertCode(
    () => writeKimiWorkspaceConfig(cwd, dirs),
    "KIMI_LOCAL_CONFIG_MODIFIED",
  );
  assert.equal(readFileSync(configPath(cwd), "utf8"), edited);
});

test("an unmodified Loom-managed file (current or the first release's format) is updated", (t) => {
  const cwd = cwdFor(t);
  writeKimiWorkspaceConfig(cwd, ["/work/old"]);
  writeKimiWorkspaceConfig(cwd, dirs);
  assert.match(
    readFileSync(configPath(cwd), "utf8"),
    /^additional_dir = \["\/work\/app", "\/work\/lib"\]$/mu,
  );
  const legacy = cwdFor(t);
  writeExisting(
    legacy,
    [
      "# Written by Loom: this Channel's attached directories (immutable).",
      "[workspace]",
      'additional_dir = ["/work/app"]',
      "",
    ].join("\n"),
  );
  writeKimiWorkspaceConfig(legacy, dirs);
  const text = readFileSync(configPath(legacy), "utf8");
  assert.match(text, /^# Managed by Loom/u);
  assert.match(text, /^additional_dir = \["\/work\/app", "\/work\/lib"\]$/mu);
});

test("a symlink or special file at local.toml or .kimi-code is refused with KIMI_LOCAL_CONFIG_UNSAFE", (t) => {
  const cwd = cwdFor(t);
  const outside = join(cwd, "outside.toml");
  writeFileSync(outside, "outside\n");
  mkdirSync(join(cwd, ".kimi-code"));
  symlinkSync(outside, configPath(cwd));
  assertCode(
    () => writeKimiWorkspaceConfig(cwd, dirs),
    "KIMI_LOCAL_CONFIG_UNSAFE",
  );
  assert.equal(readFileSync(outside, "utf8"), "outside\n");

  const directoryCase = cwdFor(t);
  mkdirSync(configPath(directoryCase), { recursive: true });
  assertCode(
    () => writeKimiWorkspaceConfig(directoryCase, dirs),
    "KIMI_LOCAL_CONFIG_UNSAFE",
  );

  const linkedDirectory = cwdFor(t);
  mkdirSync(join(linkedDirectory, "elsewhere"));
  symlinkSync(
    join(linkedDirectory, "elsewhere"),
    join(linkedDirectory, ".kimi-code"),
  );
  assertCode(
    () => writeKimiWorkspaceConfig(linkedDirectory, dirs),
    "KIMI_LOCAL_CONFIG_UNSAFE",
  );
});

test("two Kimi instances of one Channel initializing concurrently both succeed with one identical file", async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "rah-kimi-race-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rounds = 40;
  for (let index = 0; index < rounds; index += 1)
    mkdirSync(join(base, String(index)));
  const module = fileURLToPath(
    new URL("../src/channel-attached-directories.js", import.meta.url),
  );
  const script = `
    const { writeKimiWorkspaceConfig } = await import(${JSON.stringify(module)});
    for (let index = 0; index < ${rounds}; index += 1)
      writeKimiWorkspaceConfig(${JSON.stringify(base)} + "/" + index, ${JSON.stringify(dirs)});
  `;
  const run = promisify(execFile);
  await Promise.all([
    run(process.execPath, ["--input-type=module", "-e", script]),
    run(process.execPath, ["--input-type=module", "-e", script]),
  ]);
  const expected = readFileSync(configPath(join(base, "0")), "utf8");
  for (let index = 0; index < rounds; index += 1)
    assert.equal(
      readFileSync(configPath(join(base, String(index))), "utf8"),
      expected,
    );
});
