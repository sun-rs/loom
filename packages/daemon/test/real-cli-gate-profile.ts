export type RealCliGateName = "claude" | "codex" | "kimi" | "opencode";

export type RealCliGateProfile = {
  args: (cwd: string, prompt: string) => string[];
  command: string;
  model: string;
  reasoning?: string;
};

const CODEX_REASONING = new Set(["low", "medium", "high", "xhigh", "max"]);
const OPENCODE_VARIANTS = new Set(["low", "high", "max"]);

export function realCliGateProfile(
  gate: RealCliGateName,
  input: { model?: string; reasoning?: string } = {},
): RealCliGateProfile {
  if (input.reasoning === "ultra") {
    throw new Error("GPT-5.6 Ultra is forbidden for RAH OS testing");
  }
  if (gate === "codex") {
    const model = modelId(input.model ?? "gpt-5.6-sol");
    const reasoning = input.reasoning ?? "low";
    if (!CODEX_REASONING.has(reasoning)) {
      throw new Error("Codex real gate reasoning is unsupported");
    }
    return {
      args: (cwd, prompt) => [
        "exec",
        "--ephemeral",
        "--ignore-rules",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--model",
        model,
        "--config",
        `model_reasoning_effort=${reasoning}`,
        "--sandbox",
        "danger-full-access",
        "--cd",
        cwd,
        prompt,
      ],
      command: "codex",
      model,
      reasoning,
    };
  }
  if (gate === "opencode") {
    const model = modelId(input.model ?? "deepseek/deepseek-v4-flash");
    const reasoning = input.reasoning ?? "max";
    if (!OPENCODE_VARIANTS.has(reasoning)) {
      throw new Error("OpenCode real gate variant is unsupported");
    }
    return {
      args: (cwd, prompt) => [
        "run",
        "--auto",
        "--pure",
        "--dir",
        cwd,
        "--model",
        model,
        "--variant",
        reasoning,
        prompt,
      ],
      command: "opencode",
      model,
      reasoning,
    };
  }
  if (input.reasoning !== undefined) {
    throw new Error(`${gate} real gate does not accept a reasoning override`);
  }
  if (gate === "kimi") {
    const model = modelId(input.model ?? "kimi-code/k3");
    return {
      args: (_cwd, prompt) => [
        "--output-format",
        "text",
        "--model",
        model,
        "--prompt",
        prompt,
      ],
      command: "kimi",
      model,
    };
  }
  const model = modelId(input.model ?? "claude-sonnet-5");
  return {
    args: (_cwd, prompt) => [
      "--print",
      "--safe-mode",
      "--no-session-persistence",
      "--dangerously-skip-permissions",
      "--model",
      model,
      "--effort",
      "low",
      prompt,
    ],
    command: "claude",
    model,
    reasoning: "low",
  };
}

function modelId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(normalized)
  ) {
    throw new Error("real gate model ID is invalid");
  }
  return normalized;
}
