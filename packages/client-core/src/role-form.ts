import {
  RoleConfigurationSchema,
  type LocalRuntimeInventoryResponse,
  type RoleCreateRequest,
  type ServiceTier,
} from "@rah-os/protocol";
type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
type SchemaIssues = {
  issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>;
};

function issues(error: SchemaIssues): string {
  return error.issues
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.map(String).join(".")}: ${issue.message}`,
    )
    .join("；");
}

export type BindingChoice = {
  serviceTiers?: readonly string[];
  label: string;
  modelBindingId: string;
  reasoning: string[];
};

/** Preserve native compact labels; expose the actual model only for ambiguous names. */
export function roleModelLabel(
  binding: BindingChoice,
  choices: readonly BindingChoice[],
) {
  const label = (value: string) =>
    value.split("（")[0]!.replace(/^local:[^:]+:/, "");
  const display = label(binding.label);
  return choices.filter((b) => label(b.label) === display).length > 1
    ? `${display} · ${binding.modelBindingId.replace(/^local:[^:]+:/, "")}`
    : display;
}

export type RuntimeChoice = {
  bindings: BindingChoice[];
  label: string;
  runtimeOfferId: string;
};

/** Only offers the Host published, with the bindings it published for them. */
export function runtimeChoices(
  inventory: LocalRuntimeInventoryResponse,
): RuntimeChoice[] {
  return inventory.runtimes.flatMap((runtime) =>
    runtime.available && runtime.runtimeOfferId !== undefined
      ? [
          {
            bindings: runtime.modelBindingDescriptors.map((binding) => ({
              label: `${binding.displayName ?? binding.modelId}（${binding.modelBindingId}）`,
              modelBindingId: binding.modelBindingId,
              reasoning: [...binding.supportedReasoning],
              serviceTiers: [...binding.supportedServiceTiers],
            })),
            label: `${runtime.displayName}${runtime.version === undefined ? "" : ` ${runtime.version}`}（${runtime.runtimeOfferId}）`,
            runtimeOfferId: runtime.runtimeOfferId,
          },
        ]
      : [],
  );
}

export type RoleForm = {
  description?: string;
  avatarKey?: string;
  serviceTier?: ServiceTier;
  environment?: Record<string, string>;
  displayName: string;
  handle: string;
  instructions: string;
  modelBindingId: string;
  reasoning: string;
  role: string;
  runtimeOfferId: string;
};

type RoleConfiguration = RoleCreateRequest["configuration"];

/** The editable fields of an existing Role configuration (for role.revise). */
export function roleFormFrom(configuration: RoleConfiguration): RoleForm {
  return {
    description: configuration.description ?? "",
    ...(configuration.avatarKey === undefined
      ? {}
      : { avatarKey: configuration.avatarKey }),
    serviceTier: configuration.modelIntent.serviceTier ?? "default",
    environment: configuration.environment ?? {},
    displayName: configuration.displayName,
    handle: configuration.handle,
    instructions:
      configuration.role === configuration.displayName ||
      configuration.role === configuration.instructions
        ? configuration.instructions
        : `${configuration.role}\n\n${configuration.instructions}`,
    modelBindingId: configuration.modelIntent.exactBindingIds?.[0] ?? "",
    reasoning: configuration.modelIntent.reasoning ?? "",
    role: configuration.displayName,
    runtimeOfferId: configuration.runtimeOfferId,
  };
}

/**
 * `base` (a revision) keeps every configuration field the console does not
 * edit; the model intent is replaced by the exact published binding.
 */
export function buildRoleConfiguration(
  form: RoleForm,
  choices: readonly RuntimeChoice[],
  base?: RoleConfiguration,
): Checked<RoleConfiguration> {
  const runtime = choices.find(
    ({ runtimeOfferId }) => runtimeOfferId === form.runtimeOfferId,
  );
  if (runtime === undefined) {
    return { ok: false, error: "请选择 Host 已发布的 CLI" };
  }
  const binding = runtime.bindings.find(
    ({ modelBindingId }) => modelBindingId === form.modelBindingId,
  );
  if (binding === undefined) {
    return { ok: false, error: "请选择该 CLI 目录中已发布的模型" };
  }
  if (
    binding.reasoning.length > 0 &&
    !binding.reasoning.includes(form.reasoning)
  ) {
    return { ok: false, error: "请选择该模型发布的推理强度" };
  }
  if (
    form.serviceTier &&
    form.serviceTier !== "default" &&
    !binding.serviceTiers?.includes(form.serviceTier)
  )
    return { ok: false, error: "所选模型未发布该运行模式，请重新选择" };
  const parsed = RoleConfigurationSchema.safeParse({
    ...base,
    description: form.description?.trim() ?? base?.description,
    avatarKey: form.avatarKey ?? base?.avatarKey,
    environment: form.environment ?? base?.environment ?? {},
    displayName: form.displayName.trim(),
    handle: form.handle.trim(),
    instructions: form.instructions.trim(),
    modelIntent: {
      exactBindingIds: [binding.modelBindingId],
      fallback: "disabled",
      ...(form.serviceTier ? { serviceTier: form.serviceTier } : {}),
      ...(binding.reasoning.length === 0 ? {} : { reasoning: form.reasoning }),
    },
    role: form.displayName.trim(),
    runtimeOfferId: runtime.runtimeOfferId,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: `Role 配置无效：${issues(parsed.error)}` };
}
