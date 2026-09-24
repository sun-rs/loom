// Native CLI efficiency gate configuration (opt-in, paid). Pure: parses the
// RAH_EFFICIENCY_* environment and fails closed on anything ambiguous. Each
// runtime is compared with its own native CLI (contract §6); the model guard
// later enforces exactly the returned model/effort.
import { parseArmOrder } from "./warm.mjs";

// Defaults are the AGENTS.md authorized paid-gate matrix. `productUsage`:
// whether the product records per-generation usage for this runtime (Kimi ACP
// reports a capture gap, so its product usage is `unavailable` by design).
export const EFFICIENCY_PROVIDERS = {
  codex: {
    catalogKind: "codex-cli/v1",
    model: "gpt-5.6-luna",
    effort: "low",
    arms: ["native", "legacy", "role", "role-warm"],
    defaults: ["native", "legacy", "role"],
    warmAppend: true,
    instructionFile: "AGENTS.md",
    productUsage: "required",
  },
  claude: {
    catalogKind: "claude-cli/v1",
    model: "sonnet",
    effort: "low",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    arms: ["native", "legacy", "role", "role-warm"],
    defaults: ["native", "role", "role-warm"],
    warmAppend: true,
    // Claude Code reads CLAUDE.md natively (Codex and Kimi read AGENTS.md).
    instructionFile: "CLAUDE.md",
    productUsage: "required",
  },
  kimi: {
    catalogKind: "kimi-cli/v1",
    model: "kimi-code/k3",
    effort: "high",
    arms: ["native", "legacy", "role"],
    defaults: ["native", "role"],
    warmAppend: false,
    instructionFile: "AGENTS.md",
    productUsage: "not-recorded",
  },
};

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,199}$/u;
const EFFORT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;

// A catalog binding id: the full `local:<kind>:<modelId>` form or the bare
// model id the CLI publishes. Returns the bare model id.
export function resolveBindingModel(rawModel, catalogKind, fail) {
  if (!rawModel || !MODEL_PATTERN.test(rawModel))
    fail("model (binding id) is missing or malformed");
  const prefix = `local:${catalogKind}:`;
  let model = rawModel;
  if (rawModel.startsWith("local:")) {
    if (!rawModel.startsWith(prefix))
      fail(`model binding belongs to another CLI (want ${prefix})`);
    model = rawModel.slice(prefix.length);
  }
  if (!model) fail("model binding has an empty model id");
  return model;
}

export function validEffort(effort, allowed) {
  return (
    typeof effort === "string" &&
    EFFORT_PATTERN.test(effort) &&
    effort !== "default" &&
    (allowed === undefined || allowed.includes(effort))
  );
}

export function parseEfficiencyEnv(env) {
  const fail = (why) => {
    throw new Error(`Invalid efficiency gate configuration: ${why}`);
  };
  const provider = env.RAH_EFFICIENCY_PROVIDER ?? "codex";
  if (!Object.hasOwn(EFFICIENCY_PROVIDERS, provider))
    fail("RAH_EFFICIENCY_PROVIDER must be codex, claude or kimi");
  const profile = EFFICIENCY_PROVIDERS[provider];
  const model = resolveBindingModel(
    env.RAH_EFFICIENCY_MODEL ?? profile.model,
    profile.catalogKind,
    fail,
  );
  const effort = env.RAH_EFFICIENCY_EFFORT ?? profile.effort;
  if (!validEffort(effort, profile.efforts))
    fail(`RAH_EFFICIENCY_EFFORT must name an explicit ${provider} level`);
  const order = parseArmOrder(env, profile);
  return {
    provider,
    catalogKind: profile.catalogKind,
    model,
    effort,
    bindingId: `local:${profile.catalogKind}:${model}`,
    order,
    instructionFile: profile.instructionFile,
    productUsage: profile.productUsage,
  };
}
