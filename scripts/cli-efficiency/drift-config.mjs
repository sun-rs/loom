// Long-session drift gate configuration (opt-in, paid). Pure: parses the
// RAH_DRIFT_* environment and fails closed on anything ambiguous. The model
// guard later enforces exactly the returned model/effort.
const PROVIDERS = {
  codex: { catalogKind: "codex-cli/v1", modes: ["cold", "warm"] },
  kimi: { catalogKind: "kimi-cli/v1", modes: ["cold"] },
  claude: {
    catalogKind: "claude-cli/v1",
    modes: ["cold", "warm"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
};
export const DRIFT_DEFAULTS = { rounds: 20, compactAt: "8,15", mode: "cold" };
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,199}$/u;
const EFFORT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;

export function parseDriftEnv(env) {
  const fail = (why) => {
    throw new Error(`Invalid drift gate configuration: ${why}`);
  };
  const provider = env.RAH_DRIFT_PROVIDER;
  if (!Object.hasOwn(PROVIDERS, provider ?? ""))
    fail("RAH_DRIFT_PROVIDER must be codex, claude or kimi");
  const { catalogKind, modes, efforts } = PROVIDERS[provider];
  // RAH_DRIFT_MODEL is the catalog binding id: either the full
  // `local:<kind>:<modelId>` form or the bare model id the CLI publishes.
  const rawModel = env.RAH_DRIFT_MODEL;
  if (!rawModel || !MODEL_PATTERN.test(rawModel))
    fail("RAH_DRIFT_MODEL (binding id) is required");
  const prefix = `local:${catalogKind}:`;
  let model = rawModel;
  if (rawModel.startsWith("local:")) {
    if (!rawModel.startsWith(prefix))
      fail(`RAH_DRIFT_MODEL binding belongs to another CLI (want ${prefix})`);
    model = rawModel.slice(prefix.length);
  }
  if (!model) fail("RAH_DRIFT_MODEL has an empty model id");
  const effort = env.RAH_DRIFT_EFFORT;
  if (
    !effort ||
    !EFFORT_PATTERN.test(effort) ||
    effort === "default" ||
    (efforts !== undefined && !efforts.includes(effort))
  )
    fail("RAH_DRIFT_EFFORT must name an explicit reasoning level");
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
  return {
    provider,
    catalogKind,
    model,
    bindingId: prefix + model,
    effort,
    mode,
    rounds,
    // Compaction N is forced after round N completes, before round N+1.
    compactAt,
  };
}
