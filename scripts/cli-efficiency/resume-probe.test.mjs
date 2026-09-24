import assert from "node:assert/strict";
import test from "node:test";
import { parseProbeArgs } from "./resume-probe.mjs";

test("resume probe arguments: thread id required, bounded repeat and timeout", () => {
  assert.deepEqual(parseProbeArgs(["--thread", "019a-abc"]), {
    thread: "019a-abc",
    codex: "codex",
    cwd: undefined,
    repeat: 1,
    timeoutMs: 60000,
    json: false,
  });
  assert.deepEqual(
    parseProbeArgs([
      "--thread=t1",
      "--codex",
      "/opt/codex",
      "--cwd",
      "/tmp/w",
      "--repeat",
      "3",
      "--timeout-ms",
      "5000",
      "--json",
    ]),
    {
      thread: "t1",
      codex: "/opt/codex",
      cwd: "/tmp/w",
      repeat: 3,
      timeoutMs: 5000,
      json: true,
    },
  );
  for (const bad of [
    [],
    ["--thread"],
    ["--thread", "--json"],
    ["--thread", "a b"],
    ["--thread", "t", "--repeat", "0"],
    ["--thread", "t", "--repeat", "21"],
    ["--thread", "t", "--timeout-ms", "x"],
    ["--thread", "t", "--turn"],
    ["--thread", "t", "extra"],
  ])
    assert.throws(() => parseProbeArgs(bad), /resume-probe/);
});
