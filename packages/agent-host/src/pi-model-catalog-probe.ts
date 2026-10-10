import { spawn } from "node:child_process";
import {
  ExplicitReasoningLevelSchema,
  RuntimeModelBindingSchema,
  type RuntimeModelBinding,
} from "@rah-os/protocol";

const REQUESTS = [
  ["catalog", "get_available_models"],
  ["state", "get_state"],
  ["levels", "get_available_thinking_levels"],
] as const;
const MAX_BYTES = 4 * 1024 * 1024;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 1024 &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/u.test(value);

/** Read-only RPC evidence: only the configured current model has proved levels.
 * Never turn absent levels into a claim that an unselected model has no thinking.
 */
export function parsePiModelCatalog(serialized: string): RuntimeModelBinding[] {
  try {
    if (Buffer.byteLength(serialized) > MAX_BYTES || !serialized.endsWith("\n"))
      return [];
    const frames = serialized
      .trim()
      .split("\n")
      .map((line) => object(JSON.parse(line)));
    const data: Record<string, Record<string, unknown>> = {};
    for (const [id, command] of REQUESTS) {
      const matches = frames.filter((frame) => frame.id === id);
      if (matches.length !== 1) return [];
      const frame = matches[0]!;
      if (
        frame.type !== "response" ||
        frame.command !== command ||
        frame.success !== true
      )
        return [];
      data[id] = object(frame.data);
    }
    if (frames.length !== REQUESTS.length) return [];
    const state = data.state!;
    if (
      state.isStreaming !== false ||
      state.isCompacting !== false ||
      state.messageCount !== 0 ||
      state.pendingMessageCount !== 0
    )
      return [];
    const selected = object(state.model);
    if (!identifier(selected.id) || !identifier(selected.provider)) return [];
    const models = data.catalog!.models;
    if (!Array.isArray(models)) return [];
    const matches = models
      .map(object)
      .filter((m) => m.id === selected.id && m.provider === selected.provider);
    if (matches.length !== 1) return [];
    const model = matches[0]!;
    const levels = data.levels!.levels;
    if (
      !Array.isArray(levels) ||
      levels.length === 0 ||
      !levels.every(
        (level) => ExplicitReasoningLevelSchema.safeParse(level).success,
      ) ||
      new Set(levels).size !== levels.length
    )
      return [];
    if (
      typeof state.thinkingLevel !== "string" ||
      !levels.includes(state.thinkingLevel)
    )
      return [];
    const modelId = `${selected.provider}/${selected.id}`;
    return [
      RuntimeModelBindingSchema.parse({
        modelBindingId: `local:pi-cli/v1:${modelId}`,
        modelId,
        provider: selected.provider,
        ...(typeof model.name === "string" && model.name.length <= 1024
          ? { displayName: model.name }
          : {}),
        evidence: "probed",
        capabilityClasses: ["deep_coding"],
        supportedReasoning: levels,
        defaultReasoning: state.thinkingLevel,
        supportedServiceTiers: ["default"],
        adapterMapping: {
          kind: "generic-process-argv/v1",
          config: {
            modelArguments: [
              "--provider",
              selected.provider,
              "--model",
              selected.id,
            ],
            reasoningArguments: ["--thinking", "{reasoning}"],
          },
        },
      }),
    ];
  } catch {
    return [];
  }
}

export async function probePiModelCatalog(input: {
  cwd: string;
  executablePath: string;
  timeoutMs?: number;
}): Promise<RuntimeModelBinding[]> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  delete env.NODE_OPTIONS;
  const child = spawn(
    input.executablePath,
    [
      "--offline",
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--no-mcp",
      "--no-approve",
    ],
    { cwd: input.cwd, env, stdio: ["pipe", "pipe", "ignore"] },
  );
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0,
      failure: Error | undefined;
    const stop = (reason: string) => {
      failure ??= new Error(reason);
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => stop("Pi catalog probe timed out"),
      input.timeoutMs ?? 5000,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) stop("Pi catalog probe exceeded output limit");
      else chunks.push(chunk);
    });
    child.stdin.on("error", () => stop("Pi catalog input closed unexpectedly"));
    child.on("error", () => {
      failure ??= new Error("Pi catalog process failed to start");
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure || code !== 0 || signal)
        reject(failure ?? new Error("Pi catalog process did not complete"));
      else resolve(parsePiModelCatalog(Buffer.concat(chunks).toString("utf8")));
    });
    child.stdin.end(
      REQUESTS.map(([id, type]) => JSON.stringify({ id, type })).join("\n") +
        "\n",
    );
  });
}
