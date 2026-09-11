import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLaunchArgs,
  parseLaunchArgs,
  launchDiff,
} from "../src/runtime-launch-editor-model.ts";
test("argument editor roundtrips paths, quotes and shell syntax literally", () => {
  const args = [
    "--flag",
    "two words",
    "--literal",
    "$(do not execute);'quoted'",
    "--number",
    "-1",
    "--empty",
    "",
  ];
  assert.deepEqual(parseLaunchArgs(formatLaunchArgs(args)), args);
  assert.throws(() => parseLaunchArgs('--flag "unfinished'), /闭合/);
});
test("diff preserves duplicate lines and identifies changed values as removal and addition", () => {
  const rows = launchDiff("--a\n--value old\n--a", "--a\n--value new\n--a");
  assert.deepEqual(
    rows.filter((r) => r.kind === "removed").map((r) => r.text),
    ["--value old"],
  );
  assert.deepEqual(
    rows.filter((r) => r.kind === "added").map((r) => r.text),
    ["--value new"],
  );
  assert.equal(rows.filter((r) => r.kind === "same").length, 2);
});

test("required launch switches reject missing verbose and altered transport before saving", async () => {
  const { validateRequiredLaunchArgs } =
    await import("../src/runtime-launch-editor-model.ts");
  const required = ["--print", "--verbose", "--output-format", "stream-json"];
  assert.throws(
    () =>
      validateRequiredLaunchArgs(
        ["--print", "--output-format", "stream-json"],
        required,
      ),
    /--verbose/,
  );
  assert.throws(
    () =>
      validateRequiredLaunchArgs(
        ["--print", "--verbose", "--output-format", "text"],
        required,
      ),
    /stream-json/,
  );
  assert.doesNotThrow(() =>
    validateRequiredLaunchArgs([...required, "--debug"], required),
  );
  assert.throws(
    () => validateRequiredLaunchArgs(["codex", "app-server"], ["app-server"]),
    /app-server/,
  );
});

test("legacy overrides expose only additions and never put required switches in the editor", async () => {
  const { launchAdditions } =
    await import("../src/runtime-launch-editor-model.ts");
  assert.deepEqual(
    launchAdditions(
      ["--print", "--verbose", "--input-format", "stream-json"],
      [
        "--print",
        "--verbose",
        "--input-format",
        "stream-json",
        "--debug",
        "api",
      ],
    ),
    ["--debug", "api"],
  );
  assert.deepEqual(
    launchAdditions(["serve", "--pure"], ["serve", "--log-level", "debug"]),
    ["--log-level", "debug"],
  );
});
