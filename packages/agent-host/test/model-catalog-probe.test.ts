import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ResolvedModel } from "@rah-os/protocol";

import {
  LocalModelCatalogProbeCache,
  parseLocalModelCatalog,
  probeLocalModelCatalog,
  resolveModelBindingArguments,
  resolveModelBindingEnvironment,
} from "../src/model-catalog-probe.ts";

test("Claude control catalog exposes only model-specific executable effort levels", () => {
  const claude = parseLocalModelCatalog(
    "claude-cli/v1",
    JSON.stringify({
      models: [
        {
          description: "Balanced coding model",
          displayName: "Claude Sonnet",
          supportedEffortLevels: ["low", "medium", "high", "max"],
          supportsEffort: true,
          value: "claude-sonnet-test",
        },
        {
          description: "Fast model",
          displayName: "Claude Haiku",
          supportedEffortLevels: ["high"],
          supportsEffort: false,
          value: "claude-haiku-test",
        },
      ],
    }),
  );

  assert.deepEqual(
    claude.map(({ modelId }) => modelId),
    ["claude-sonnet-test", "claude-haiku-test"],
  );
  assert.equal(claude[0]?.displayName, "Claude Sonnet");
  assert.equal(claude[0]?.description, "Balanced coding model");
  assert.deepEqual(claude[0]?.supportedReasoning, [
    "low",
    "medium",
    "high",
    "max",
  ]);
  assert.deepEqual(claude[1]?.supportedReasoning, []);
  assert.deepEqual(
    resolveModelBindingArguments(claude[0]!, {
      modelBindingId: claude[0]!.modelBindingId,
      modelId: claude[0]!.modelId,
      provider: claude[0]!.provider,
      reasoning: "high",
      source: "explicit_binding",
    }),
    ["--model", "claude-sonnet-test", "--effort", "high"],
  );
});

test("model catalog cache deduplicates by executable evidence and never pins empty results", async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new LocalModelCatalogProbeCache({
    now: () => now,
    probe: async () => {
      calls += 1;
      return calls === 1
        ? []
        : parseLocalModelCatalog(
            "claude-cli/v1",
            JSON.stringify({
              models: [
                {
                  displayName: "Claude Test",
                  supportsEffort: false,
                  value: "claude-test",
                },
              ],
            }),
          );
    },
    ttlMs: 60_000,
  });
  const input = {
    cwd: "/workspace",
    executableContentDigest: `sha256:${"1".repeat(64)}`,
    executablePath: "/usr/local/bin/claude",
    kind: "claude-cli/v1" as const,
  };

  assert.deepEqual(await cache.probe(input), []);
  assert.equal((await cache.probe(input))[0]?.modelId, "claude-test");
  assert.equal(calls, 2, "an empty discovery result must not be cached");

  await cache.probe(input);
  assert.equal(
    calls,
    2,
    "a successful catalog should be cached within its TTL",
  );

  await cache.probe({
    ...input,
    executableContentDigest: `sha256:${"2".repeat(64)}`,
  });
  assert.equal(calls, 3, "new executable bytes require a new discovery round");

  now += 60_001;
  await cache.probe({
    ...input,
    executableContentDigest: `sha256:${"2".repeat(64)}`,
  });
  assert.equal(calls, 4, "expired evidence must be refreshed");
});

test("Claude probe uses a bounded read-only control handshake", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rah-os-claude-catalog-"));
  const executablePath = join(cwd, "fake-claude.mjs");
  const invocationLog = join(cwd, "claude-args.json");
  try {
    writeFileSync(
      executablePath,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.cwd(), "claude-args.json"), JSON.stringify(process.argv.slice(2)));
let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  const newline = buffered.indexOf("\\n");
  if (newline < 0) return;
  const request = JSON.parse(buffered.slice(0, newline));
  process.stdout.write(JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: request.request_id,
      response: {
        account: { email: "must-not-be-projected@example.invalid" },
        models: [{
          value: "claude-test",
          displayName: "Claude Test",
          description: "Machine-readable test model",
          supportsEffort: true,
          supportedEffortLevels: ["low", "high"]
        }]
      }
    }
  }) + "\\n");
});
`,
      "utf8",
    );
    chmodSync(executablePath, 0o755);

    const bindings = await probeLocalModelCatalog({
      cwd,
      executablePath,
      kind: "claude-cli/v1",
    });
    assert.equal(bindings[0]?.modelId, "claude-test");
    assert.equal(
      JSON.stringify(bindings).includes("must-not-be-projected"),
      false,
    );
    const args = JSON.parse(readFileSync(invocationLog, "utf8")) as string[];
    assert.ok(args.includes("stream-json"));
    assert.ok(args.includes("--no-session-persistence"));
    assert.ok(args.includes("--safe-mode"));
    assert.ok(args.includes("--tools"));
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

test("Codex catalog preserves native order, labels, defaults, and future-safe reasoning tokens", () => {
  const bindings = parseLocalModelCatalog(
    "codex-cli/v1",
    JSON.stringify({
      models: [
        {
          default_reasoning_level: "low",
          display_name: "GPT Zeta",
          service_tiers: [{ id: "priority" }],
          slug: "gpt-zeta",
          supported_in_api: true,
          supported_reasoning_levels: [
            { description: "Quick", effort: "low" },
            { description: "Deep", effort: "xhigh" },
            { description: "Delegated", effort: "ultra" },
          ],
          visibility: "list",
        },
        {
          default_reasoning_level: "medium",
          display_name: "GPT Alpha",
          service_tiers: [],
          slug: "gpt-alpha",
          supported_in_api: true,
          supported_reasoning_levels: [{ effort: "medium" }],
          visibility: "list",
        },
        {
          service_tiers: [],
          slug: "hidden-model",
          supported_in_api: true,
          supported_reasoning_levels: [],
          visibility: "hide",
        },
      ],
    }),
  );
  assert.deepEqual(
    bindings.map(({ modelId }) => modelId),
    ["gpt-zeta", "gpt-alpha"],
  );
  assert.equal(bindings[0]?.displayName, "GPT Zeta");
  assert.equal(bindings[0]?.defaultReasoning, "low");
  assert.deepEqual(bindings[0]?.supportedReasoning, ["low", "xhigh", "ultra"]);
  assert.deepEqual(bindings[0]?.reasoningOptions, [
    { description: "Quick", label: "Low", value: "low" },
    { description: "Deep", label: "Extra high", value: "xhigh" },
    { description: "Delegated", label: "Ultra", value: "ultra" },
  ]);
  assert.deepEqual(bindings[0]?.supportedServiceTiers, ["default", "priority"]);
});

test("Kimi maps observed effort metadata to its native per-process environment override", () => {
  const kimi = parseLocalModelCatalog(
    "kimi-cli/v1",
    JSON.stringify({
      models: {
        "kimi-code/k3": {
          defaultEffort: "high",
          displayName: "K3",
          model: "k3",
          provider: "managed:kimi-code",
          supportEfforts: ["low", "high", "max"],
        },
      },
      providers: {},
    }),
  );
  assert.equal(kimi[0]?.modelId, "kimi-code/k3");
  assert.equal(kimi[0]?.displayName, "K3");
  assert.equal(kimi[0]?.defaultReasoning, "high");
  assert.deepEqual(kimi[0]?.supportedReasoning, ["low", "high", "max"]);
  assert.deepEqual(kimi[0]?.reasoningOptions, [
    { label: "Low", value: "low" },
    { label: "High", value: "high" },
    { label: "Max", value: "max" },
  ]);
  const resolved = {
    modelBindingId: kimi[0]!.modelBindingId,
    modelId: "kimi-code/k3",
    provider: "kimi-code",
    reasoning: "max",
    source: "explicit_binding",
  } satisfies ResolvedModel;
  assert.deepEqual(resolveModelBindingArguments(kimi[0]!, resolved), [
    "--model",
    "kimi-code/k3",
  ]);
  assert.deepEqual(resolveModelBindingEnvironment(kimi[0]!, resolved), {
    KIMI_MODEL_THINKING_EFFORT: "max",
  });
});

test("OpenCode verbose catalog turns model variants into executable --variant bindings", () => {
  const opencode = parseLocalModelCatalog(
    "opencode-cli/v1",
    `deepseek/deepseek-v4-flash
{
  "id": "deepseek-v4-flash",
  "name": "DeepSeek V4 Flash",
  "variants": {
    "low": { "reasoningEffort": "low" },
    "high": { "reasoningEffort": "high" },
    "max": { "reasoningEffort": "max" },
    "disabled": { "disabled": true, "reasoningEffort": "high" }
  }
}
openai/gpt-5.6-luna
{
  "id": "gpt-5.6-luna",
  "name": "GPT-5.6 Luna",
  "variants": {}
}
`,
  );
  assert.deepEqual(
    opencode.map(({ modelId }) => modelId),
    ["deepseek/deepseek-v4-flash", "openai/gpt-5.6-luna"],
  );
  assert.equal(opencode[0]?.displayName, "DeepSeek V4 Flash");
  assert.deepEqual(opencode[0]?.supportedReasoning, ["low", "high", "max"]);
  assert.deepEqual(opencode[0]?.reasoningOptions, [
    { label: "Low", value: "low" },
    { label: "High", value: "high" },
    { label: "Max", value: "max" },
  ]);

  const binding = opencode[0]!;
  assert.deepEqual(
    resolveModelBindingArguments(binding, {
      modelBindingId: binding.modelBindingId,
      modelId: binding.modelId,
      provider: binding.provider,
      reasoning: "max",
      source: "explicit_binding",
    }),
    ["--model", "deepseek/deepseek-v4-flash", "--variant", "max"],
  );
});

test("resolved model binding becomes shell-free argv and rejects mismatches", () => {
  const [binding] = parseLocalModelCatalog(
    "codex-cli/v1",
    JSON.stringify({
      models: [
        {
          service_tiers: [{ id: "priority" }],
          slug: "gpt-5.6-luna",
          supported_in_api: true,
          supported_reasoning_levels: [{ effort: "high" }],
          visibility: "list",
        },
      ],
    }),
  );
  const resolved = {
    modelBindingId: binding!.modelBindingId,
    modelId: binding!.modelId,
    provider: binding!.provider,
    reasoning: "high",
    serviceTier: "priority",
    source: "explicit_binding",
  } satisfies ResolvedModel;
  assert.deepEqual(resolveModelBindingArguments(binding!, resolved), [
    "--model",
    "gpt-5.6-luna",
    "--config",
    "model_reasoning_effort=high",
    "--config",
    "service_tier=priority",
  ]);
  assert.throws(
    () =>
      resolveModelBindingArguments(binding!, {
        ...resolved,
        modelId: "different-model",
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      resolveModelBindingArguments(binding!, {
        ...resolved,
        reasoning: "medium",
      }),
    /does not support reasoning/,
  );
  assert.throws(
    () =>
      resolveModelBindingArguments(binding!, {
        ...resolved,
        serviceTier: "fast",
      }),
    /does not support service tier/,
  );
});

test("model catalogs are bounded before they enter immutable probe evidence", () => {
  const models = Object.fromEntries(
    Array.from({ length: 600 }, (_, index) => [
      `provider/model-${String(index).padStart(3, "0")}`,
      { provider: "managed:provider" },
    ]),
  );
  models[`provider/${"x".repeat(1_100)}`] = {
    provider: "managed:provider",
  };

  const bindings = parseLocalModelCatalog(
    "kimi-cli/v1",
    JSON.stringify({ models, providers: {} }),
  );
  assert.equal(bindings.length, 512);
  assert.equal(
    bindings.some(({ modelId }) => modelId.length > 1_024),
    false,
  );
});

test("OpenCode keeps usable partial output and falls back for older CLIs", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rah-os-opencode-catalog-"));
  const executablePath = join(cwd, "fake-opencode.mjs");
  try {
    writeFileSync(
      executablePath,
      `#!/usr/bin/env node
import { existsSync } from "node:fs";
const verbose = process.argv.includes("--verbose");
if (verbose && existsSync(new URL("./force-fallback", import.meta.url))) {
  process.stderr.write("unknown option --verbose\\n");
  process.exit(2);
}
if (verbose) {
  process.stdout.write('deepseek/deepseek-v4-flash\\n{"name":"DeepSeek V4 Flash","variants":{"max":{}}}\\n');
  process.exit(1);
}
process.stdout.write("deepseek/deepseek-v4-flash\\n");
`,
      "utf8",
    );
    chmodSync(executablePath, 0o755);

    const partial = await probeLocalModelCatalog({
      cwd,
      executablePath,
      kind: "opencode-cli/v1",
    });
    assert.deepEqual(partial[0]?.supportedReasoning, ["max"]);

    writeFileSync(join(cwd, "force-fallback"), "", "utf8");
    const fallback = await probeLocalModelCatalog({
      cwd,
      executablePath,
      kind: "opencode-cli/v1",
    });
    assert.equal(fallback[0]?.modelId, "deepseek/deepseek-v4-flash");
    assert.deepEqual(fallback[0]?.supportedReasoning, []);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

test("Codex prefers the refreshed catalog and falls back to bundled models offline", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rah-os-codex-catalog-"));
  const executablePath = join(cwd, "fake-codex.mjs");
  const invocationLog = join(cwd, "invocations.log");
  try {
    writeFileSync(
      executablePath,
      `#!/usr/bin/env node
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const bundled = process.argv.includes("--bundled");
appendFileSync(join(process.cwd(), "invocations.log"), bundled ? "bundled\\n" : "refreshed\\n");
if (!bundled && existsSync(join(process.cwd(), "fail-refreshed"))) {
  process.stderr.write("catalog refresh unavailable\\n");
  process.exit(2);
}
const slug = bundled ? "gpt-bundled" : "gpt-refreshed";
process.stdout.write(JSON.stringify({ models: [{
  slug,
  supported_in_api: true,
  supported_reasoning_levels: [{ effort: "low" }],
  visibility: "list"
}] }));
`,
      "utf8",
    );
    chmodSync(executablePath, 0o755);

    const refreshed = await probeLocalModelCatalog({
      cwd,
      executablePath,
      kind: "codex-cli/v1",
    });
    assert.equal(refreshed[0]?.modelId, "gpt-refreshed");
    assert.equal(readFileSync(invocationLog, "utf8"), "refreshed\n");

    writeFileSync(join(cwd, "fail-refreshed"), "", "utf8");
    const bundled = await probeLocalModelCatalog({
      cwd,
      executablePath,
      kind: "codex-cli/v1",
    });
    assert.equal(bundled[0]?.modelId, "gpt-bundled");
    assert.equal(
      readFileSync(invocationLog, "utf8"),
      "refreshed\nrefreshed\nbundled\n",
    );
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});
