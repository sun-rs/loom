import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLines } from "./cli-process.mjs";

test("native CLI receives the fixture working directory in both cwd and PWD", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "loom-native-cwd-")));
  try {
    const run = await runLines({
      executable: process.execPath,
      args: [
        "-e",
        "console.log(JSON.stringify({cwd:process.cwd(),pwd:process.env.PWD}))",
      ],
      cwd,
      env: { ...process.env, PWD: "/incorrect-parent-directory" },
      onSpawn() {},
    });
    assert.equal(run.exit, 0);
    assert.deepEqual(JSON.parse(run.entries[0].line), { cwd, pwd: cwd });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
