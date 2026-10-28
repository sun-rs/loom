// The single approval source for the paid CLI gates (efficiency and drift).
// Both config parsers and the guarded shim writer check this table, so an
// unapproved provider/model/effort combination fails before the gate spawns
// any provider process. `effort: null` is an effortless binding (no effort
// argument at all). Changing this table needs explicit owner approval and
// must stay in step with the AGENTS.md authorization table.
const row = (provider, model, effort, approvedOn, note) =>
  Object.freeze({ provider, model, effort, approvedOn, note });

export const APPROVED_GATE_MODELS = Object.freeze([
  row(
    "kimi",
    "kimi-code/kimi-for-coding",
    "low",
    "2026-10-28",
    "Owner requested K2.8; catalog display K2.8 Preview",
  ),
  row(
    "pi",
    "magpie/kimi-code-cn/k3.1-pro",
    "low",
    "2026-10-28",
    "Owner approved current Kimi route",
  ),
  row("pi", "aihubmix/deepseek-v4.1-flash", "low", "2026-10-10"),
  row(
    "codex",
    "gpt-6-sol",
    "low",
    "2026-10-03",
    "负责人批准用于 Loom 优势讨论测试",
  ),
  row(
    "codex",
    "gpt-6-astra",
    "low",
    "2026-10-03",
    "负责人批准用于 Loom 优势讨论测试",
  ),
  row("opencode", "aihubmix/deepseek-v4.1-flash", "low", "2026-09-30"),
  // AGENTS.md matrix, 2026-09-09.
  row("claude", "sonnet", "low", "2026-09-09"),
  row("codex", "gpt-5.6-luna", "low", "2026-09-09"),
  row(
    "opencode",
    "deepseek/deepseek-v4-flash",
    "low",
    "2026-09-09",
    "no longer published by the installed OpenCode catalog (replaced by deepseek/deepseek-flash); the catalog check fails before any paid call",
  ),
  row("kimi", "kimi-code/k3", "high", "2026-09-09"),
  // Owner approval, 2026-09-25.
  row("codex", "gpt-6-luna", "low", "2026-09-25"),
  row("kimi", "kimi-code/k3-256k", "low", "2026-09-25"),
  row(
    "claude",
    "haiku",
    null,
    "2026-09-25",
    "the catalog publishes no effort levels",
  ),
  row(
    "opencode",
    "deepseek/deepseek-flash",
    "low",
    "2026-09-25",
    "DeepSeek V4.1 Flash, replaces deepseek/deepseek-v4-flash",
  ),
]);

// Never admitted, whatever the table says (defence in depth).
const FORBIDDEN_MODEL = /fable|ultra/iu;
const FORBIDDEN_EFFORT = new Set(["max", "ultra", "xhigh"]);

export function findApprovedGateModel({ provider, model, effort }) {
  return APPROVED_GATE_MODELS.find(
    (r) => r.provider === provider && r.model === model && r.effort === effort,
  );
}

export function assertApprovedGateModel({ provider, model, effort }) {
  const shown = `${provider} ${model} / ${effort === null ? "no effort" : effort}`;
  if (
    typeof model !== "string" ||
    FORBIDDEN_MODEL.test(model) ||
    FORBIDDEN_EFFORT.has(effort)
  )
    throw new Error(`Unapproved paid gate model (forbidden): ${shown}`);
  const approved = findApprovedGateModel({ provider, model, effort });
  if (!approved)
    throw new Error(
      `Unapproved paid gate model: ${shown} is not in scripts/cli-efficiency/approved-models.mjs`,
    );
  return approved;
}
