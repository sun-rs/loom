import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { mock } from "node:test";
if (process.env.LOOM_TOOL_ADMISSION_CHILD !== "1") {
  test("failed free tool probe blocks both paid entry paths", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--test",
        fileURLToPath(import.meta.url),
      ],
      {
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: undefined,
          LOOM_TOOL_ADMISSION_CHILD: "1",
        },
        encoding: "utf8",
        timeout: 20000,
      },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /tests 2/);
  });
} else {
  mock.module(new URL("./codex-tool-preflight.mjs", import.meta.url).href, {
    namedExports: {
      ensureCodexToolPreflight: async () => {
        throw Error("fixture native host approval pending");
      },
    },
  });
  const { nativeRound } = await import("./native.mjs");
  const { prepareGateDaemon } = await import("./gate-daemon.mjs");
  test("native prompt is not sent after failed tool probe", async () => {
    const round = {};
    await assert.rejects(
      nativeRound({
        cwd: "/tmp",
        prompt: "must not send",
        round,
        save() {
          throw Error("must not start");
        },
        config: { model: "gpt-6-luna", effort: "low" },
      }),
      /fixture native host approval pending/,
    );
    assert.equal(round.pid, undefined);
  });
  test("Loom daemon is not prepared after failed tool probe", async () => {
    await assert.rejects(
      prepareGateDaemon({
        provider: "codex",
        model: "gpt-6-luna",
        effort: "low",
        root: "/unused-fixture-path",
        cwd: "/tmp",
        processes: [],
        save() {
          throw Error("must not start");
        },
      }),
      /fixture native host approval pending/,
    );
  });
}
