import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  RuntimeModelBindingSchema,
  type ExplicitReasoningLevel,
  type ResolvedModel,
  type RuntimeModelBinding,
  type ServiceTier,
} from "@rah-os/protocol";

const execFileAsync = promisify(execFile);
const EXPLICIT_REASONING = new Set<ExplicitReasoningLevel>([
  "low",
  "medium",
  "high",
  "max",
]);
const SERVICE_TIERS = new Set<ServiceTier>(["default", "fast", "priority"]);
const MAX_CATALOG_BINDINGS = 512;
const MAX_CATALOG_IDENTIFIER_LENGTH = 1_024;

export type LocalModelCatalogKind =
  "codex-cli/v1" | "kimi-cli/v1" | "opencode-cli/v1";

export async function probeLocalModelCatalog(input: {
  cwd: string;
  executablePath: string;
  kind: LocalModelCatalogKind;
  timeoutMs?: number;
}): Promise<RuntimeModelBinding[]> {
  const args =
    input.kind === "codex-cli/v1"
      ? ["debug", "models", "--bundled"]
      : input.kind === "kimi-cli/v1"
        ? ["provider", "list", "--json"]
        : ["models", "--pure"];
  const { stdout } = await execFileAsync(input.executablePath, args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 4 * 1_024 * 1_024,
    timeout: input.timeoutMs ?? 5_000,
    windowsHide: true,
  });
  return parseLocalModelCatalog(input.kind, stdout);
}

export function parseLocalModelCatalog(
  kind: LocalModelCatalogKind,
  serialized: string,
): RuntimeModelBinding[] {
  const bindings =
    kind === "codex-cli/v1"
      ? parseCodexCatalog(serialized)
      : kind === "kimi-cli/v1"
        ? parseKimiCatalog(serialized)
        : parseOpenCodeCatalog(serialized);
  return [
    ...new Map(
      bindings.map((candidate) => [candidate.modelBindingId, candidate]),
    ).values(),
  ]
    .sort((left, right) =>
      left.modelBindingId.localeCompare(right.modelBindingId),
    )
    .slice(0, MAX_CATALOG_BINDINGS);
}

export function resolveModelBindingArguments(
  binding: RuntimeModelBinding,
  resolved: ResolvedModel,
): string[] {
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
  if (binding.adapterMapping.kind !== "generic-process-argv/v1") {
    throw new Error(
      `unsupported model adapter mapping: ${binding.adapterMapping.kind}`,
    );
  }
  const config = binding.adapterMapping.config;
  const modelArguments = stringArray(config.modelArguments, "modelArguments");
  const reasoningArguments = optionalStringArray(
    config.reasoningArguments,
    "reasoningArguments",
  );
  const serviceTierArguments = optionalStringArray(
    config.serviceTierArguments,
    "serviceTierArguments",
  );
  const values = {
    modelId: resolved.modelId,
    reasoning: resolved.reasoning,
    serviceTier: resolved.serviceTier,
  };
  return [
    ...expandArguments(modelArguments, values, "modelArguments"),
    ...(resolved.reasoning === undefined
      ? []
      : expandArguments(
          reasoningArguments ?? [],
          values,
          "reasoningArguments",
        )),
    ...(resolved.serviceTier === undefined
      ? []
      : expandArguments(
          serviceTierArguments ?? [],
          values,
          "serviceTierArguments",
        )),
  ];
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
    const reasoning = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels.flatMap((entry) => {
          const effort = stringValue(record(entry).effort);
          return effort !== undefined &&
            EXPLICIT_REASONING.has(effort as ExplicitReasoningLevel)
            ? [effort as ExplicitReasoningLevel]
            : [];
        })
      : [];
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
    return [
      binding({
        kind: "kimi-cli/v1",
        mapping: { modelArguments: ["--model", "{modelId}"] },
        modelId: normalizedModelId,
        provider: provider.replace(/^managed:/u, ""),
        reasoning: [],
        serviceTiers: ["default"],
      }),
    ];
  });
}

function parseOpenCodeCatalog(serialized: string): RuntimeModelBinding[] {
  return [...new Set(serialized.split(/\r?\n/u).map((line) => line.trim()))]
    .filter(
      (line) =>
        line.length <= MAX_CATALOG_IDENTIFIER_LENGTH &&
        /^[^\s/]+\/[^\s/][^\s]*$/u.test(line),
    )
    .map((modelId) =>
      binding({
        kind: "opencode-cli/v1",
        mapping: { modelArguments: ["--model", "{modelId}"] },
        modelId,
        provider: modelId.split("/", 1)[0]!,
        reasoning: [],
        serviceTiers: ["default"],
      }),
    );
}

function binding(input: {
  kind: LocalModelCatalogKind;
  mapping: Record<string, string[]>;
  modelId: string;
  provider: string;
  reasoning: ExplicitReasoningLevel[];
  serviceTiers: ServiceTier[];
}): RuntimeModelBinding {
  return RuntimeModelBindingSchema.parse({
    adapterMapping: {
      config: input.mapping,
      kind: "generic-process-argv/v1",
    },
    capabilityClasses: ["deep_coding"],
    evidence: "probed",
    modelBindingId: `local:${input.kind}:${input.modelId}`,
    modelId: input.modelId,
    provider: input.provider,
    supportedReasoning: [...new Set(input.reasoning)],
    supportedServiceTiers: [...new Set(input.serviceTiers)],
  });
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
