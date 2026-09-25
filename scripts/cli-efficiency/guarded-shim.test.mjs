import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNoGuardViolations,
  guardViolationPath,
  writeGuardedShim,
} from "./guarded-shim.mjs";

const dir = mkdtempSync(join(tmpdir(), "loom-shim-test-"));
const APPROVED = {
  codex: ["gpt-6-luna", "low"],
  claude: ["haiku", null],
  kimi: ["kimi-code/k3-256k", "low"],
  opencode: ["deepseek/deepseek-flash", "low"],
};
const read = (provider, options, pair = APPROVED[provider] ?? ["m", "e"]) =>
  readFileSync(
    writeGuardedShim({
      provider,
      path: join(dir, `${provider}.mjs`),
      realCli: "/bin/real",
      model: pair[0],
      effort: pair[1],
      options,
    }),
    "utf8",
  );

test("each provider's shim calls its own guard with the exact model/effort", () => {
  const codex = read("codex", { socketRecordPath: "/r" });
  assert.match(
    codex,
    /runGuardedCodex\("\/bin\/real", \{"model":"gpt-6-luna","effort":"low","socketRecordPath":"\/r"\}\)/,
  );
  const claude = read("claude", { injectRecordPath: "/i" });
  assert.match(claude, /claude-guard\.mjs/);
  const violations = JSON.stringify(
    guardViolationPath(join(dir, "claude.mjs")),
  );
  assert.ok(
    claude.includes(
      `runGuardedClaude("/bin/real", {"model":"haiku","effort":null}, {"injectRecordPath":"/i","violationRecordPath":${violations}})`,
    ),
    claude,
  );
  const kimi = read("kimi");
  assert.match(
    kimi,
    /runGuardedKimi\("\/bin\/real", \{"model":"kimi-code\/k3-256k","effort":"low"\}\)/,
  );
  assert.equal(statSync(join(dir, "kimi.mjs")).mode & 0o777, 0o700);
  const opencode = read("opencode", {
    compactionOptions: { reasoningEffort: "low" },
  });
  assert.match(opencode, /drift-opencode-guard\.mjs/);
  assert.match(
    opencode,
    /runGuardedOpenCode\("\/bin\/real", \{"model":"deepseek\/deepseek-flash","effort":"low"\}, \{"compactionOptions":\{"reasoningEffort":"low"\}\}\)/,
  );
  assert.throws(() => read("gemini"), /No gate guard|Unapproved/);
});

test("a shim is never written for a combination outside the approval table", () => {
  for (const [provider, pair] of [
    ["codex", ["gpt-6-sol", "low"]],
    ["codex", ["gpt-6-luna", "ultra"]],
    ["claude", ["opus", "max"]],
    ["claude", ["fable", "low"]],
    ["kimi", ["kimi-code/k3", "max"]],
    ["opencode", ["deepseek/deepseek-flash", "max"]],
  ]) {
    const path = join(dir, `refused-${provider}-${pair.join("-")}.mjs`);
    assert.throws(
      () =>
        writeGuardedShim({
          provider,
          path,
          realCli: "/bin/real",
          model: pair[0],
          effort: pair[1],
        }),
      /Unapproved paid gate model/,
    );
    assert.equal(existsSync(path), false);
  }
});

test("guard violation records fail the arm; none recorded passes", () => {
  const shim = join(dir, "violations-shim.mjs");
  assert.doesNotThrow(() => assertNoGuardViolations(shim));
  writeFileSync(
    guardViolationPath(shim),
    JSON.stringify({ reason: "Unapproved model claude-opus-5-5" }) + "\n",
  );
  assert.throws(
    () => assertNoGuardViolations(shim),
    /Unapproved model claude-opus-5-5/,
  );
});

test("options carry transport settings only; model/effort overrides are refused", () => {
  for (const [provider, options] of [
    ["codex", { socketRecordPath: "/r", model: "gpt-6-sol" }],
    ["codex", { effort: "high" }],
    ["codex", { model: "gpt-6-sol", effort: "high" }],
    ["claude", { injectRecordPath: "/i", model: "opus" }],
    ["claude", { violationRecordPath: "/elsewhere" }],
    ["kimi", { effort: "max" }],
    ["kimi", { socketRecordPath: "/r" }],
    [
      "opencode",
      { compactionOptions: { reasoningEffort: "low" }, model: "x/y" },
    ],
    ["codex", { reasoning: "high" }],
  ]) {
    const path = join(
      dir,
      `override-${provider}-${Object.keys(options).join("-")}.mjs`,
    );
    const [model, effort] = APPROVED[provider];
    assert.throws(
      () =>
        writeGuardedShim({
          provider,
          path,
          realCli: "/bin/real",
          model,
          effort,
          options,
        }),
      /Unsupported guarded shim option/,
    );
    assert.equal(existsSync(path), false);
  }
});
