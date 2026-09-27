// Native CLI efficiency gate configuration (opt-in, paid). Pure: parses the
// RAH_EFFICIENCY_* environment and fails closed on anything ambiguous or
// outside the owner approval table (approved-models.mjs). Each runtime is
// compared with its own native CLI (contract §6); the model guard later
// enforces exactly the returned model/effort.
import { assertApprovedGateModel } from "./approved-models.mjs";
import { parseArmOrder } from "./warm.mjs";

// The explicit "no effort" value (an effortless binding such as Claude
// `haiku`, whose catalog entry publishes no effort levels).
export const NO_EFFORT = "none";
// Claude Code effort levels (the approval table narrows them further).
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// Defaults are the current owner-approved gate models (approved-models.mjs).
// `role-prewarm` (owner 2026-09-27, opt-in via RAH_EFFICIENCY_ORDER): the
// warm instance prewarmed at creation, reported beside the cold role-warm arm.
// `productUsage`: whether the product must have recorded per-generation
// usage for this runtime. Every runtime is `required` (Kimi since evo §40:
// the driver reads the session wire; full review 2 B-P1-2); a missing or
// partial record is `usageEvidenceMissing`, never exempt.
export const EFFICIENCY_PROVIDERS = {
  codex: {
    catalogKind: "codex-cli/v1",
    model: "gpt-6-luna",
    effort: "low",
    arms: ["native", "legacy", "role", "role-warm", "role-prewarm"],
    // The product runs Codex warm by default; role-warm measures that path.
    defaults: ["native", "legacy", "role", "role-warm"],
    warmAppend: true,
    instructionFile: "AGENTS.md",
    productUsage: "required",
  },
  claude: {
    catalogKind: "claude-cli/v1",
    model: "haiku",
    effort: null,
    efforts: CLAUDE_EFFORTS,
    // Bindings the installed Claude Code catalog publishes without effort
    // levels (probed 2026-09-25: `haiku`, supportsEffort false).
    effortless: ["haiku"],
    arms: ["native", "legacy", "role", "role-warm", "role-prewarm"],
    defaults: ["native", "role", "role-warm"],
    warmAppend: true,
    // Claude Code reads CLAUDE.md natively (the others read AGENTS.md).
    instructionFile: "CLAUDE.md",
    productUsage: "required",
  },
  kimi: {
    catalogKind: "kimi-cli/v1",
    model: "kimi-code/k3-256k",
    effort: "low",
    arms: ["native", "legacy", "role"],
    defaults: ["native", "role"],
    warmAppend: false,
    instructionFile: "AGENTS.md",
    productUsage: "required",
  },
  // OpenCode binding ids are `provider/model`; the reasoning level is the
  // catalog variant. The product runs OpenCode warm by default.
  opencode: {
    catalogKind: "opencode-cli/v1",
    model: "deepseek/deepseek-flash",
    effort: "low",
    modelPattern: /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._/:-]*$/u,
    arms: ["native", "role", "role-warm", "role-prewarm"],
    defaults: ["native", "role", "role-warm"],
    warmAppend: false,
    instructionFile: "AGENTS.md",
    productUsage: "required",
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

// Shared by both gates: an effortless binding requires the explicit "none"
// and yields null; every other binding requires an explicit valid level.
export function resolveEffort(
  rawEffort,
  { model, provider, efforts, effortless = [] },
  fail,
  name,
) {
  const noEffort = effortless.includes(model);
  if (noEffort && rawEffort !== NO_EFFORT)
    fail(`${name} must be ${NO_EFFORT}: ${model} publishes no effort levels`);
  if (!noEffort && rawEffort === NO_EFFORT)
    fail(
      `${name}=${NO_EFFORT} is allowed only for an effortless binding (${provider}: ${effortless.join(", ") || "none"})`,
    );
  if (noEffort) return null;
  if (!validEffort(rawEffort, efforts))
    fail(`${name} must name an explicit ${provider} reasoning level`);
  return rawEffort;
}

export function parseEfficiencyEnv(env) {
  const fail = (why) => {
    throw new Error(`Invalid efficiency gate configuration: ${why}`);
  };
  const provider = env.RAH_EFFICIENCY_PROVIDER ?? "codex";
  if (!Object.hasOwn(EFFICIENCY_PROVIDERS, provider))
    fail("RAH_EFFICIENCY_PROVIDER must be codex, claude, kimi or opencode");
  const profile = EFFICIENCY_PROVIDERS[provider];
  const model = resolveBindingModel(
    env.RAH_EFFICIENCY_MODEL ?? profile.model,
    profile.catalogKind,
    fail,
  );
  if (profile.modelPattern !== undefined && !profile.modelPattern.test(model))
    fail(`model must be a provider/model binding for ${provider}`);
  const effort = resolveEffort(
    env.RAH_EFFICIENCY_EFFORT ?? profile.effort ?? NO_EFFORT,
    {
      model,
      provider,
      efforts: profile.efforts,
      effortless: profile.effortless,
    },
    fail,
    "RAH_EFFICIENCY_EFFORT",
  );
  try {
    assertApprovedGateModel({ provider, model, effort });
  } catch (error) {
    fail(error.message);
  }
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

// Dimensions neither side can measure for a runtime whose product usage is
// not required (none today): reported as unmeasured, never invented. A
// `required` runtime is exempt from nothing; missing evidence fails.
export function unmeasuredDimensions({ productUsage }, metrics) {
  if (productUsage === "required") return [];
  const all = (key) =>
    metrics.every((m) => typeof m[key] === "number" && Number.isFinite(m[key]));
  return [
    "productUsage",
    ...(all("input") && all("firstInput") ? [] : ["tokens"]),
    ...(all("generationsTotal") && all("generationsBeforeReply")
      ? []
      : ["generations"]),
  ];
}
