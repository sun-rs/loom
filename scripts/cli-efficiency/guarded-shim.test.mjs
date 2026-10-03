import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNoGuardViolations,
  guardViolationPath,
  resolveGateShimOptions,
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
    ["codex", ["gpt-6.1-sol", "low"]],
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

// Efficiency gate regression (2026-09-25): the efficiency arms wrote an
// OpenCode shim without compaction options, so every guarded serve exited
// with `Compaction reasoning options are required` before listening.
test("an OpenCode shim is never written without compaction reasoning options", () => {
  for (const options of [undefined, {}, { compactionOptions: {} }]) {
    const path = join(dir, `opencode-no-compaction-${Math.random()}.mjs`);
    assert.throws(
      () =>
        writeGuardedShim({
          provider: "opencode",
          path,
          realCli: "/bin/real",
          model: "deepseek/deepseek-flash",
          effort: "low",
          options,
        }),
      /compaction reasoning options/,
    );
    assert.equal(existsSync(path), false);
  }
});

const FAKE_CATALOG_CLI = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_CATALOG_RECORD, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write([
  "deepseek/deepseek-flash",
  "{",
  '  "id": "deepseek-flash",',
  '  "variants": { "low": { "reasoningEffort": "low" }, "high": { "reasoningEffort": "high" } }',
  "}",
].join("\\n") + "\\n");
`;

test("gate shim options: OpenCode compaction options come only from the CLI's verbose catalog", () => {
  const fake = join(dir, "fake-catalog-opencode.mjs");
  writeFileSync(fake, FAKE_CATALOG_CLI, { mode: 0o700 });
  const record = join(dir, "fake-catalog-record.jsonl");
  const previous = process.env.FAKE_CATALOG_RECORD;
  process.env.FAKE_CATALOG_RECORD = record;
  try {
    const base = {
      provider: "opencode",
      realCli: fake,
      model: "deepseek/deepseek-flash",
      effort: "low",
    };
    assert.deepEqual(resolveGateShimOptions({ ...base, options: {} }), {
      compactionOptions: { reasoningEffort: "low" },
    });
    assert.deepEqual(
      resolveGateShimOptions({ ...base, options: { controlRecordPath: "/c" } }),
      {
        controlRecordPath: "/c",
        compactionOptions: { reasoningEffort: "low" },
      },
    );
    assert.deepEqual(
      readFileSync(record, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))[0],
      ["models", "deepseek", "--verbose", "--pure"],
    );
    // A caller cannot supply its own (possibly wrong) compaction options.
    assert.throws(
      () =>
        resolveGateShimOptions({
          ...base,
          options: { compactionOptions: { reasoningEffort: "high" } },
        }),
      /catalog/,
    );
    // The resolved options are exactly what the written shim passes.
    const shim = readFileSync(
      writeGuardedShim({
        ...base,
        path: join(dir, "opencode-resolved.mjs"),
        options: resolveGateShimOptions({ ...base, options: {} }),
      }),
      "utf8",
    );
    assert.ok(
      shim.includes(`{"compactionOptions":{"reasoningEffort":"low"}}`),
      shim,
    );
    // Other providers: options unchanged, no catalog call.
    const calls = readFileSync(record, "utf8").trim().split("\n").length;
    assert.deepEqual(
      resolveGateShimOptions({
        provider: "codex",
        realCli: fake,
        model: "gpt-6-luna",
        effort: "low",
        options: { socketRecordPath: "/r" },
      }),
      { socketRecordPath: "/r" },
    );
    assert.equal(readFileSync(record, "utf8").trim().split("\n").length, calls);
  } finally {
    if (previous === undefined) delete process.env.FAKE_CATALOG_RECORD;
    else process.env.FAKE_CATALOG_RECORD = previous;
  }
});

test("launchRecordPath: every guarded launch records its cwd, probe flag and --add-dir values first", () => {
  const work = mkdtempSync(join(tmpdir(), "loom-shim-launch-"));
  const fake = join(work, "fake-kimi.mjs");
  // FAKE Kimi CLI (no model): prints a version.
  writeFileSync(fake, '#!/usr/bin/env node\nconsole.log("0.39.1");\n', {
    mode: 0o700,
  });
  const launchRecordPath = join(work, "launches.jsonl");
  const shim = writeGuardedShim({
    provider: "kimi",
    path: join(work, "guarded-kimi.mjs"),
    realCli: fake,
    model: "kimi-code/k3-256k",
    effort: "low",
    launchRecordPath,
  });
  const run = spawnSync(shim, ["--version"], { cwd: work, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const [record] = readFileSync(launchRecordPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.equal(record.cwd, realpathSync(work));
  assert.equal(record.subcommand, "--version");
  assert.equal(record.probe, true);
  assert.deepEqual(record.addDirs, []);
  // Without the path, the shim text has no launch record.
  assert.ok(!read("kimi").includes("appendGateLaunchRecord"));
  assert.ok(
    readFileSync(shim, "utf8").includes("appendGateLaunchRecord"),
    "recorded before the guard",
  );
});
