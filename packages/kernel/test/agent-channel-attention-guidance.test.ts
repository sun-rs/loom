import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { channelAttentionGuidance } from "../src/agent-channel-attention-guidance.ts";

test("mute guidance shell command preserves literal targets and uses the supplied Worker entry", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah attention quote "));
  const executable = join(directory, "rah");
  // Controlled marker substitutions only print text, never perform filesystem
  // or network actions. The red test safely exposes incorrect double quoting.
  const target = "#$(printf SUBSTITUTED)`printf BACKTICK`'\" room";
  writeFileSync(
    executable,
    `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o700 },
  );
  try {
    for (const muted of [true, false]) {
      const guidance = channelAttentionGuidance(muted, target);
      const command = (muted ? guidance.unmuteCommand : guidance.muteCommand)!;
      const output = execFileSync("/bin/sh", ["-c", command], {
        env: { PATH: directory, RAH_WORKER_CLI: executable },
        encoding: "utf8",
      });
      assert.deepEqual(JSON.parse(output), [
        "worker",
        muted ? "channel-unmute" : "channel-mute",
        "--target",
        target,
      ]);
      assert.ok(command.startsWith('"$RAH_WORKER_CLI" worker '), command);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("oversized or overescaped targets omit optional command instead of exceeding transport bounds", () => {
  for (const target of ["#" + "x".repeat(501), "#" + "'".repeat(499)]) {
    assert.equal(
      channelAttentionGuidance(true, target).unmuteCommand,
      undefined,
    );
    assert.equal(
      channelAttentionGuidance(false, target).muteCommand,
      undefined,
    );
  }
});
