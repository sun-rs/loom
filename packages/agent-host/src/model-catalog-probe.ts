import {
  parsePiModelCatalog,
  probePiModelCatalog,
} from "./pi-model-catalog-probe.ts";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  ExplicitReasoningLevelSchema,
  RuntimeModelBindingSchema,
  type ExplicitReasoningLevel,
  type ModelBindingDescriptor,
  type ResolvedModel,
  type RuntimeModelBinding,
  type ServiceTier,
} from "@rah-os/protocol";

const execFileAsync = promisify(execFile);
const SERVICE_TIERS = new Set<ServiceTier>(["default", "fast", "priority"]);
const MAX_CATALOG_BINDINGS = 512;
const MAX_CATALOG_IDENTIFIER_LENGTH = 1_024;
const MAX_CLAUDE_CONTROL_OUTPUT_BYTES = 4 * 1_024 * 1_024;
let claudeCatalogRequestSequence = 0;

export type LocalModelCatalogKind =
  | "claude-cli/v1"
  | "codex-cli/v1"
  | "kimi-cli/v1"
  | "opencode-cli/v1"
  | "pi-cli/v1";

export type LocalModelCatalogProbeInput = {
  cwd: string;
  executablePath: string;
  kind: LocalModelCatalogKind;
  timeoutMs?: number;
};

type LocalModelCatalogProbe = (
  input: LocalModelCatalogProbeInput,
) => Promise<RuntimeModelBinding[]>;

export class LocalModelCatalogProbeCache {
  readonly #entries = new Map<
    string,
    { bindings: RuntimeModelBinding[]; expiresAt: number }
  >();
  readonly #inFlight = new Map<string, Promise<RuntimeModelBinding[]>>();
  readonly #now: () => number;
  readonly #probeCatalog: LocalModelCatalogProbe;
  readonly #ttlMs: number;

  constructor(
    input: {
      now?: () => number;
      probe?: LocalModelCatalogProbe;
      ttlMs?: number;
    } = {},
  ) {
    this.#now = input.now ?? Date.now;
    this.#probeCatalog = input.probe ?? probeLocalModelCatalog;
    this.#ttlMs = input.ttlMs ?? 60_000;
    if (!Number.isInteger(this.#ttlMs) || this.#ttlMs <= 0) {
      throw new Error("model catalog cache ttlMs must be a positive integer");
    }
  }

  async probe(
    input: LocalModelCatalogProbeInput & {
      executableContentDigest: string;
    },
  ): Promise<RuntimeModelBinding[]> {
    const key = JSON.stringify([
      input.kind,
      input.executablePath,
      input.executableContentDigest,
      input.cwd,
    ]);
    const cached = this.#entries.get(key);
    if (cached !== undefined && this.#now() < cached.expiresAt) {
      return structuredClone(cached.bindings);
    }
    const existing = this.#inFlight.get(key);
    if (existing !== undefined) return structuredClone(await existing);
    const request = this.#probeCatalog(input)
      .then((bindings) => {
        if (bindings.length > 0) {
          this.#entries.set(key, {
            bindings: structuredClone(bindings),
            expiresAt: this.#now() + this.#ttlMs,
          });
        }
        return bindings;
      })
      .finally(() => {
        if (this.#inFlight.get(key) === request) this.#inFlight.delete(key);
      });
    this.#inFlight.set(key, request);
    return structuredClone(await request);
  }
}

export async function probeLocalModelCatalog(
  input: LocalModelCatalogProbeInput,
): Promise<RuntimeModelBinding[]> {
  if (input.kind === "pi-cli/v1") return await probePiModelCatalog(input);
  if (input.kind === "claude-cli/v1") {
    return await probeClaudeModelCatalog(input);
  }
  if (input.kind === "codex-cli/v1") {
    try {
      const refreshed = await executeCatalogProbe(input, ["debug", "models"]);
      const bindings = parseLocalModelCatalog(input.kind, refreshed);
      if (bindings.length > 0) return bindings;
    } catch {
      // The refreshed catalog can be unavailable while offline or when an
      // older Codex build only exposes its bundled snapshot. The bundled
      // catalog is executable evidence from these exact CLI bytes, so it is a
      // safe fallback; an empty or invalid fallback still fails the probe.
    }
    return parseLocalModelCatalog(
      input.kind,
      await executeCatalogProbe(input, ["debug", "models", "--bundled"]),
    );
  }
  if (input.kind === "opencode-cli/v1") {
    try {
      const verbose = await executeCatalogProbe(input, [
        "models",
        "--verbose",
        "--pure",
      ]);
      const bindings = parseLocalModelCatalog(input.kind, verbose);
      if (bindings.length > 0) return bindings;
    } catch {
      // Older OpenCode versions may not support --verbose. The plain catalog
      // remains useful for model selection, but never invents variants.
    }
    return parseLocalModelCatalog(
      input.kind,
      await executeCatalogProbe(input, ["models", "--pure"]),
    );
  }
  const args = ["provider", "list", "--json"];
  return parseLocalModelCatalog(
    input.kind,
    await executeCatalogProbe(input, args),
  );
}

async function probeClaudeModelCatalog(
  input: LocalModelCatalogProbeInput,
): Promise<RuntimeModelBinding[]> {
  return parseLocalModelCatalog(
    input.kind,
    await executeClaudeControlCatalogProbe(input),
  );
}

async function executeClaudeControlCatalogProbe(
  input: LocalModelCatalogProbeInput,
): Promise<string> {
  const requestId = `rah-os-model-catalog-${process.pid}-${++claudeCatalogRequestSequence}`;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_ENTRYPOINT: "rah-os-model-catalog",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
  delete environment.DEBUG;
  delete environment.NODE_OPTIONS;
  const child = spawn(
    input.executablePath,
    [
      "--output-format",
      "stream-json",
      "--verbose",
      "--input-format",
      "stream-json",
      "--tools",
      "",
      "--setting-sources=",
      "--no-session-persistence",
      "--safe-mode",
    ],
    {
      cwd: input.cwd,
      env: environment,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    },
  );
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    let buffered = "";
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(
      () => fail(new Error("Claude model catalog probe timed out")),
      input.timeoutMs ?? 15_000,
    );

    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const hardKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 1_000);
      hardKill.unref();
    };
    const finish = (serialized: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      terminate();
      resolvePromise(serialized);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy();
      terminate();
      rejectPromise(error);
    };
    const parseLine = (line: string) => {
      let message: Record<string, unknown>;
      try {
        message = record(JSON.parse(line) as unknown);
      } catch {
        return;
      }
      if (message.type !== "control_response") return;
      const response = record(message.response);
      if (response.request_id !== requestId) return;
      if (response.subtype !== "success") {
        fail(new Error("Claude model catalog control request failed"));
        return;
      }
      const payload = record(response.response);
      if (!Array.isArray(payload.models)) {
        fail(new Error("Claude model catalog response omitted models"));
        return;
      }
      finish(JSON.stringify({ models: payload.models }));
    };

    child.once("error", () =>
      fail(new Error("Claude model catalog process could not start")),
    );
    child.once("exit", () => {
      if (!settled) {
        fail(new Error("Claude model catalog process exited before response"));
      }
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_CLAUDE_CONTROL_OUTPUT_BYTES) {
        fail(new Error("Claude model catalog response exceeded byte limit"));
        return;
      }
      buffered += chunk;
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) break;
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        parseLine(line);
        if (settled) break;
      }
    });
    child.stdin.write(
      `${JSON.stringify({
        request_id: requestId,
        type: "control_request",
        request: { subtype: "initialize" },
      })}\n`,
      (error) => {
        if (error !== null && error !== undefined) {
          fail(new Error("Claude model catalog request could not be written"));
        }
      },
    );
  });
}

async function executeCatalogProbe(
  input: {
    cwd: string;
    executablePath: string;
    kind: LocalModelCatalogKind;
    timeoutMs?: number;
  },
  args: string[],
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(input.executablePath, args, {
      cwd: input.cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 4 * 1_024 * 1_024,
      timeout:
        input.timeoutMs ?? (input.kind === "opencode-cli/v1" ? 15_000 : 5_000),
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const partialStdout = commandFailureStdout(error);
    if (partialStdout !== undefined) return partialStdout;
    throw error;
  }
}

function commandFailureStdout(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("stdout" in error)) {
    return undefined;
  }
  const stdout = (error as { stdout?: unknown }).stdout;
  return typeof stdout === "string" && stdout.trim() !== ""
    ? stdout
    : undefined;
}

export function parseLocalModelCatalog(
  kind: LocalModelCatalogKind,
  serialized: string,
): RuntimeModelBinding[] {
  if (kind === "pi-cli/v1") return parsePiModelCatalog(serialized);
  const bindings =
    kind === "claude-cli/v1"
      ? parseClaudeCatalog(serialized)
      : kind === "codex-cli/v1"
        ? parseCodexCatalog(serialized)
        : kind === "kimi-cli/v1"
          ? parseKimiCatalog(serialized)
          : parseOpenCodeCatalog(serialized);
  return [
    ...new Map(
      bindings.map((candidate) => [candidate.modelBindingId, candidate]),
    ).values(),
  ].slice(0, MAX_CATALOG_BINDINGS);
}

function parseClaudeCatalog(serialized: string): RuntimeModelBinding[] {
  const root = jsonRecord(serialized);
  const models = Array.isArray(root.models) ? root.models : [];
  return models.flatMap((unchecked) => {
    const model = record(unchecked);
    const modelId = catalogIdentifier(model.value);
    if (modelId === undefined) return [];
    const reasoningOptions =
      model.supportsEffort === true &&
      Array.isArray(model.supportedEffortLevels)
        ? reasoningOptionsFromValues(model.supportedEffortLevels)
        : [];
    const description = stringValue(model.description);
    const displayName = stringValue(model.displayName);
    return [
      binding({
        kind: "claude-cli/v1",
        mapping: {
          modelArguments: ["--model", "{modelId}"],
          ...(reasoningOptions.length === 0
            ? {}
            : { reasoningArguments: ["--effort", "{reasoning}"] }),
        },
        modelId,
        provider: "anthropic",
        reasoning: reasoningOptions.map((option) => option.value),
        reasoningOptions,
        ...(description === undefined ? {} : { description }),
        ...(displayName === undefined ? {} : { displayName }),
        serviceTiers: ["default"],
      }),
    ];
  });
}

export function resolveModelBindingArguments(
  binding: RuntimeModelBinding,
  resolved: ResolvedModel,
): string[] {
  const { config, values } = requireModelBindingLaunch(binding, resolved);
  const modelArguments = stringArray(config.modelArguments, "modelArguments");
  const reasoningArguments = optionalStringArray(
    config.reasoningArguments,
    "reasoningArguments",
  );
  const serviceTierArguments = optionalStringArray(
    config.serviceTierArguments,
    "serviceTierArguments",
  );
  return [
    ...expandArguments(modelArguments, values, "modelArguments"),
    ...(values.reasoning === undefined
      ? []
      : expandArguments(
          reasoningArguments ?? [],
          values,
          "reasoningArguments",
        )),
    ...(values.serviceTier === undefined
      ? []
      : expandArguments(
          serviceTierArguments ?? [],
          values,
          "serviceTierArguments",
        )),
  ];
}

export function resolveModelBindingEnvironment(
  binding: RuntimeModelBinding,
  resolved: ResolvedModel,
): Record<string, string> {
  const { config, kind, values } = requireModelBindingLaunch(binding, resolved);
  if (kind === "generic-process-argv/v1") return {};
  const reasoningEnvironment = optionalStringArray(
    config.reasoningEnvironment,
    "reasoningEnvironment",
  );
  if (values.reasoning === undefined || reasoningEnvironment === undefined) {
    return {};
  }
  if (
    reasoningEnvironment.length !== 2 ||
    !/^[A-Z_][A-Z0-9_]*$/u.test(reasoningEnvironment[0]!)
  ) {
    throw new Error(
      "model adapter mapping reasoningEnvironment must be [VARIABLE, template]",
    );
  }
  return {
    [reasoningEnvironment[0]!]: expandArguments(
      [reasoningEnvironment[1]!],
      values,
      "reasoningEnvironment",
    )[0]!,
  };
}

function requireModelBindingLaunch(
  binding: RuntimeModelBinding,
  resolved: ResolvedModel,
): {
  config: Record<string, unknown>;
  kind: "generic-process-argv/v1" | "generic-process-launch/v1";
  values: {
    modelId: string;
    reasoning: string | undefined;
    serviceTier: string | undefined;
  };
} {
  if (
    resolved.source !== "explicit_binding" ||
    resolved.modelBindingId !== binding.modelBindingId ||
    resolved.modelId !== binding.modelId ||
    resolved.provider !== binding.provider
  ) {
    throw new Error("resolved model does not match Runtime model binding");
  }
  if (
    resolved.reasoning !== undefined &&
    !binding.supportedReasoning.includes(resolved.reasoning)
  ) {
    throw new Error(
      `Runtime model binding ${binding.modelBindingId} does not support reasoning ${resolved.reasoning}`,
    );
  }
  if (
    resolved.serviceTier !== undefined &&
    !binding.supportedServiceTiers.includes(resolved.serviceTier)
  ) {
    throw new Error(
      `Runtime model binding ${binding.modelBindingId} does not support service tier ${resolved.serviceTier}`,
    );
  }
  if (
    binding.adapterMapping.kind !== "generic-process-argv/v1" &&
    binding.adapterMapping.kind !== "generic-process-launch/v1"
  ) {
    throw new Error(
      `unsupported model adapter mapping: ${binding.adapterMapping.kind}`,
    );
  }
  const config = binding.adapterMapping.config;
  const values = {
    modelId: resolved.modelId,
    reasoning: resolved.reasoning,
    serviceTier: resolved.serviceTier,
  };
  return { config, kind: binding.adapterMapping.kind, values };
}

function parseCodexCatalog(serialized: string): RuntimeModelBinding[] {
  const root = jsonRecord(serialized);
  const models = Array.isArray(root.models) ? root.models : [];
  return models.flatMap((unchecked) => {
    const model = record(unchecked);
    const modelId = catalogIdentifier(model.slug);
    if (
      modelId === undefined ||
      model.visibility !== "list" ||
      model.supported_in_api !== true
    ) {
      return [];
    }
    const reasoningOptions = reasoningOptionsFromCodex(model);
    const reasoning = reasoningOptions.map((option) => option.value);
    const defaultReasoning = reasoningValue(
      model.default_reasoning_level ?? model.defaultReasoningLevel,
    );
    const displayName = stringValue(model.display_name ?? model.displayName);
    const description = stringValue(model.description);
    const serviceTiers: ServiceTier[] = ["default"];
    if (Array.isArray(model.service_tiers)) {
      for (const entry of model.service_tiers) {
        const id = stringValue(record(entry).id);
        if (
          id !== undefined &&
          SERVICE_TIERS.has(id as ServiceTier) &&
          !serviceTiers.includes(id as ServiceTier)
        ) {
          serviceTiers.push(id as ServiceTier);
        }
      }
    }
    return [
      binding({
        kind: "codex-cli/v1",
        mapping: {
          modelArguments: ["--model", "{modelId}"],
          reasoningArguments: [
            "--config",
            "model_reasoning_effort={reasoning}",
          ],
          serviceTierArguments: ["--config", "service_tier={serviceTier}"],
        },
        modelId,
        provider: "openai",
        reasoning,
        reasoningOptions,
        ...(defaultReasoning !== undefined &&
        reasoning.includes(defaultReasoning)
          ? { defaultReasoning }
          : {}),
        ...(displayName === undefined ? {} : { displayName }),
        ...(description === undefined ? {} : { description }),
        serviceTiers,
      }),
    ];
  });
}

function parseKimiCatalog(serialized: string): RuntimeModelBinding[] {
  const root = jsonRecord(serialized);
  const models = record(root.models);
  return Object.entries(models).flatMap(([modelId, unchecked]) => {
    const model = record(unchecked);
    const provider = catalogIdentifier(model.provider);
    const normalizedModelId = catalogIdentifier(modelId);
    if (provider === undefined || normalizedModelId === undefined) return [];
    const reasoningOptions = Array.isArray(model.supportEfforts)
      ? reasoningOptionsFromValues(model.supportEfforts)
      : [];
    const defaultReasoning = reasoningValue(model.defaultEffort);
    const displayName = stringValue(model.displayName);
    return [
      binding({
        kind: "kimi-cli/v1",
        mapping: {
          modelArguments: ["--model", "{modelId}"],
          reasoningEnvironment: ["KIMI_MODEL_THINKING_EFFORT", "{reasoning}"],
        },
        mappingKind: "generic-process-launch/v1",
        modelId: normalizedModelId,
        provider: provider.replace(/^managed:/u, ""),
        reasoning: reasoningOptions.map((option) => option.value),
        reasoningOptions,
        ...(defaultReasoning !== undefined &&
        reasoningOptions.some((option) => option.value === defaultReasoning)
          ? { defaultReasoning }
          : {}),
        ...(displayName === undefined ? {} : { displayName }),
        serviceTiers: ["default"],
      }),
    ];
  });
}

function parseOpenCodeCatalog(serialized: string): RuntimeModelBinding[] {
  const lines = serialized.split(/\r?\n/u);
  const bindings: RuntimeModelBinding[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const modelId = openCodeModelId(lines[index] ?? "");
    if (modelId === undefined || seen.has(modelId)) continue;
    seen.add(modelId);
    let metadata: Record<string, unknown> = {};
    let next = index + 1;
    while (next < lines.length && lines[next]?.trim() === "") next += 1;
    if (lines[next]?.trimStart().startsWith("{")) {
      const collected = collectOpenCodeMetadata(lines, next);
      metadata = collected.metadata;
      index = collected.resumeAt - 1;
    }
    const reasoningOptions = reasoningOptionsFromOpenCode(metadata.variants);
    const displayName = stringValue(metadata.name);
    const mapping: Record<string, string[]> = {
      modelArguments: ["--model", "{modelId}"],
      ...(reasoningOptions.length > 0
        ? { reasoningArguments: ["--variant", "{reasoning}"] }
        : {}),
    };
    bindings.push(
      binding({
        kind: "opencode-cli/v1",
        mapping,
        modelId,
        provider: modelId.slice(0, modelId.indexOf("/")),
        reasoning: reasoningOptions.map((option) => option.value),
        reasoningOptions,
        ...(displayName === undefined ? {} : { displayName }),
        serviceTiers: ["default"],
      }),
    );
  }
  return bindings;
}

function binding(input: {
  kind: LocalModelCatalogKind;
  mapping: Record<string, string[]>;
  mappingKind?: "generic-process-argv/v1" | "generic-process-launch/v1";
  modelId: string;
  provider: string;
  reasoning: ExplicitReasoningLevel[];
  reasoningOptions?: ModelBindingDescriptor["reasoningOptions"];
  defaultReasoning?: ExplicitReasoningLevel;
  description?: string;
  displayName?: string;
  serviceTiers: ServiceTier[];
}): RuntimeModelBinding {
  return RuntimeModelBindingSchema.parse({
    adapterMapping: {
      config: input.mapping,
      kind: input.mappingKind ?? "generic-process-argv/v1",
    },
    capabilityClasses: ["deep_coding"],
    ...(input.defaultReasoning === undefined
      ? {}
      : { defaultReasoning: input.defaultReasoning }),
    ...(input.displayName === undefined
      ? {}
      : { displayName: input.displayName }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    evidence: "probed",
    modelBindingId: `local:${input.kind}:${input.modelId}`,
    modelId: input.modelId,
    provider: input.provider,
    ...(input.reasoningOptions === undefined
      ? {}
      : { reasoningOptions: input.reasoningOptions }),
    supportedReasoning: [...new Set(input.reasoning)],
    supportedServiceTiers: [...new Set(input.serviceTiers)],
  });
}

function reasoningOptionsFromCodex(
  model: Record<string, unknown>,
): NonNullable<ModelBindingDescriptor["reasoningOptions"]> {
  const raw = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
    : Array.isArray(model.supported_reasoning_efforts)
      ? model.supported_reasoning_efforts
      : Array.isArray(model.supportedReasoningLevels)
        ? model.supportedReasoningLevels
        : Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts
          : [];
  const options: NonNullable<ModelBindingDescriptor["reasoningOptions"]> = [];
  const seen = new Set<string>();
  for (const unchecked of raw) {
    const entry = record(unchecked);
    const value = reasoningValue(entry.effort ?? entry.reasoningEffort);
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    const description = stringValue(entry.description);
    options.push({
      value,
      label: reasoningLabel(value),
      ...(description === undefined ? {} : { description }),
    });
  }
  return options;
}

function reasoningOptionsFromValues(
  values: unknown[],
): NonNullable<ModelBindingDescriptor["reasoningOptions"]> {
  const options: NonNullable<ModelBindingDescriptor["reasoningOptions"]> = [];
  const seen = new Set<string>();
  for (const unchecked of values) {
    const value = reasoningValue(unchecked);
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: reasoningLabel(value) });
  }
  return options;
}

function reasoningOptionsFromOpenCode(
  unchecked: unknown,
): NonNullable<ModelBindingDescriptor["reasoningOptions"]> {
  const variants = record(unchecked);
  const options: NonNullable<ModelBindingDescriptor["reasoningOptions"]> = [];
  for (const [variantId, rawVariant] of Object.entries(variants)) {
    if (variantId === "default" || record(rawVariant).disabled === true) {
      continue;
    }
    const value = reasoningValue(variantId);
    if (value === undefined) continue;
    options.push({ value, label: reasoningLabel(value) });
  }
  return options;
}

function reasoningValue(value: unknown): ExplicitReasoningLevel | undefined {
  const parsed = ExplicitReasoningLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function reasoningLabel(value: string): string {
  if (value === "xhigh") return "Extra high";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function openCodeModelId(line: string): string | undefined {
  const normalized = line.trim();
  return normalized.length <= MAX_CATALOG_IDENTIFIER_LENGTH &&
    /^[^\s/]+\/[^\s/][^\s]*$/u.test(normalized)
    ? normalized
    : undefined;
}

function collectOpenCodeMetadata(
  lines: string[],
  start: number,
): { metadata: Record<string, unknown>; resumeAt: number } {
  let serialized = "";
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && openCodeModelId(lines[index] ?? "") !== undefined) {
      return { metadata: {}, resumeAt: index };
    }
    serialized += `${serialized === "" ? "" : "\n"}${lines[index] ?? ""}`;
    try {
      return {
        metadata: record(JSON.parse(serialized) as unknown),
        resumeAt: index + 1,
      };
    } catch {
      // Pretty-printed JSON is expected to be incomplete until its closing line.
    }
  }
  return { metadata: {}, resumeAt: lines.length };
}

function jsonRecord(serialized: string): Record<string, unknown> {
  return record(JSON.parse(serialized) as unknown);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function catalogIdentifier(value: unknown): string | undefined {
  const normalized = stringValue(value);
  return normalized !== undefined &&
    normalized.length <= MAX_CATALOG_IDENTIFIER_LENGTH &&
    /^\S+$/u.test(normalized)
    ? normalized
    : undefined;
}

function stringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`model adapter mapping ${field} must be a string array`);
  }
  return [...value] as string[];
}

function optionalStringArray(
  value: unknown,
  field: string,
): string[] | undefined {
  return value === undefined ? undefined : stringArray(value, field);
}

function expandArguments(
  templates: string[],
  values: {
    modelId: string;
    reasoning: string | undefined;
    serviceTier: string | undefined;
  },
  field: string,
): string[] {
  return templates.map((template) =>
    template.replace(/\{(modelId|reasoning|serviceTier)\}/gu, (_, key) => {
      const value = values[key as keyof typeof values];
      if (value === undefined) {
        throw new Error(`model adapter mapping ${field} requires ${key}`);
      }
      return value;
    }),
  );
}
