// Long-session drift gate configuration (opt-in, paid). Pure: parses the
// RAH_DRIFT_* environment and fails closed on anything ambiguous or outside
// the owner approval table (approved-models.mjs). The model guard later
// enforces exactly the returned model/effort. Binding and effort parsing are
// shared with the efficiency gate (efficiency-config.mjs).
import { assertApprovedGateModel } from "./approved-models.mjs";
import {
  EFFICIENCY_PROVIDERS,
  NO_EFFORT,
  resolveBindingModel,
  resolveEffort,
} from "./efficiency-config.mjs";

const profile = (provider, modes) => {
  const { catalogKind, efforts, effortless, modelPattern } =
    EFFICIENCY_PROVIDERS[provider];
  return { catalogKind, efforts, effortless, modelPattern, modes };
};
const PROVIDERS = {
  codex: profile("codex", ["cold", "warm"]),
  kimi: profile("kimi", ["cold"]),
  claude: profile("claude", ["cold", "warm"]),
  opencode: profile("opencode", ["cold", "warm"]),
};
// The explicit "no effort" value (an effortless Claude binding only).
export const DRIFT_NO_EFFORT = NO_EFFORT;
export const DRIFT_DEFAULTS = {
  rounds: 20,
  compactAt: "8,15",
  mode: "cold",
  // Owner 2026-09-25 B: a post-compaction window whose mean input or protocol
  // calls exceed the first pre-compaction window by more than this ratio
  // flags compactionOverheadRising (RAH_DRIFT_OVERHEAD_RISE).
  overheadRise: 0.25,
};

export function parseDriftEnv(env) {
  const fail = (why) => {
    throw new Error(`Invalid drift gate configuration: ${why}`);
  };
  const provider = env.RAH_DRIFT_PROVIDER;
  if (!Object.hasOwn(PROVIDERS, provider ?? ""))
    fail("RAH_DRIFT_PROVIDER must be codex, claude, kimi or opencode");
  const { catalogKind, modes, efforts, effortless, modelPattern } =
    PROVIDERS[provider];
  // RAH_DRIFT_MODEL is the catalog binding id: either the full
  // `local:<kind>:<modelId>` form or the bare model id the CLI publishes.
  const model = resolveBindingModel(env.RAH_DRIFT_MODEL, catalogKind, (why) =>
    fail(`RAH_DRIFT_MODEL: ${why}`),
  );
  if (modelPattern !== undefined && !modelPattern.test(model))
    fail(`RAH_DRIFT_MODEL must be a provider/model binding for ${provider}`);
  // null: no effort argument at all (the guard then admits zero --effort).
  const effort = resolveEffort(
    env.RAH_DRIFT_EFFORT,
    { model, provider, efforts, effortless },
    fail,
    "RAH_DRIFT_EFFORT",
  );
  try {
    assertApprovedGateModel({ provider, model, effort });
  } catch (error) {
    fail(error.message);
  }
  const mode = env.RAH_DRIFT_MODE ?? DRIFT_DEFAULTS.mode;
  if (!["cold", "warm"].includes(mode))
    fail("RAH_DRIFT_MODE must be warm or cold");
  if (!modes.includes(mode))
    fail(`RAH_DRIFT_MODE=${mode} is not supported for ${provider}`);
  const roundsText = env.RAH_DRIFT_ROUNDS ?? String(DRIFT_DEFAULTS.rounds);
  const rounds = Number(roundsText);
  if (!/^\d+$/u.test(roundsText) || rounds < 6 || rounds > 60)
    fail("RAH_DRIFT_ROUNDS must be an integer in 6..60");
  const compactText = env.RAH_DRIFT_COMPACT_AT ?? DRIFT_DEFAULTS.compactAt;
  const compactAt =
    compactText.trim() === ""
      ? []
      : compactText.split(",").map((s) => {
          const t = s.trim();
          const n = Number(t);
          if (!/^\d+$/u.test(t))
            fail(`compaction round "${t}" is not a number`);
          return n;
        });
  for (let i = 0; i < compactAt.length; i++) {
    const n = compactAt[i];
    if (n < 1 || n >= rounds)
      fail(`compaction round ${n} must be in 1..${rounds - 1}`);
    if (i > 0 && n <= compactAt[i - 1])
      fail("RAH_DRIFT_COMPACT_AT must be strictly increasing");
  }
  const riseText = env.RAH_DRIFT_OVERHEAD_RISE;
  const overheadRise =
    riseText === undefined ? DRIFT_DEFAULTS.overheadRise : Number(riseText);
  if (
    riseText !== undefined &&
    (!/^\d+(\.\d+)?$/u.test(riseText) ||
      !(overheadRise > 0) ||
      overheadRise > 10)
  )
    fail("RAH_DRIFT_OVERHEAD_RISE must be a number in (0, 10]");
  return {
    provider,
    catalogKind,
    model,
    bindingId: `local:${catalogKind}:${model}`,
    effort,
    mode,
    rounds,
    // Compaction N is forced after round N completes, before round N+1.
    compactAt,
    overheadRise,
  };
}
