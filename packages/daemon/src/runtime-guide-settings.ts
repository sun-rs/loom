import {
  PROVIDER_LAUNCH_ARGS_ENV,
  providerLaunchDefaults,
  providerLaunchRequiredArgs,
  providerLaunchPolicy,
  validateProviderLaunchArgs,
  validateProviderLaunchOverride,
} from "@rah-os/agent-host";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { z } from "zod";
import { ConflictError } from "@rah-os/kernel";
import {
  RuntimeGuideUpdateSchema,
  type RuntimeGuideUpdate,
  type RuntimeGuideSettingsView,
} from "@rah-os/protocol";

const State = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.array(z.enum(["codex", "claude"])).max(2),
    overrides: z
      .record(
        z.enum(["codex", "claude", "kimi", "opencode"]),
        z.array(z.string()).nullable(),
      )
      .optional(),
    additionalArgs: z
      .record(
        z.enum(["codex", "claude", "kimi", "opencode"]),
        z.array(z.string()),
      )
      .optional(),
  })
  .strict();
const capabilities = [
  {
    runtimeId: "codex",
    supported: true,
    detail: "app-server 原生追加；当前轮和会话条件满足时投递。",
  },
  {
    runtimeId: "claude",
    supported: true,
    detail: "stream-json 条件式追加；等待允许的工具边界。",
  },
  {
    runtimeId: "kimi",
    supported: false,
    detail: "当前 ACP 接法未接通 Guide，使用等待发送。",
  },
  {
    runtimeId: "opencode",
    supported: false,
    detail: "原生追加尚未接通并验收，使用等待发送。",
  },
] as const;

/** Single daemon owner. Preferences only: all pending work remains in Kernel Inbox/Activation. */
export class RuntimeGuideSettings {
  #state: z.infer<typeof State>;
  readonly path: string;
  constructor(path: string) {
    this.path = path;
    this.#state = existsSync(path)
      ? State.parse(JSON.parse(readFileSync(path, "utf8")))
      : { revision: 0, enabled: ["codex", "claude"] };
  }
  enabled(runtimeId: string | undefined): boolean {
    return this.#state.enabled.some((id) => id === runtimeId);
  }
  runtimeOptions() {
    return {
      guideEnabled: (runtimeId: string | undefined) => this.enabled(runtimeId),
      launchEnvironment: (runtimeId: string) => ({
        [PROVIDER_LAUNCH_ARGS_ENV]: JSON.stringify({
          runtimeId,
          overrideArgs:
            this.read().runtimes.find((r) => r.runtimeId === runtimeId)
              ?.overrideArgs ?? null,
          additionalArgs:
            this.read().runtimes.find((r) => r.runtimeId === runtimeId)
              ?.additionalArgs ?? [],
        }),
      }),
    };
  }
  read(): RuntimeGuideSettingsView {
    return {
      revision: this.#state.revision,
      runtimes: capabilities.map((row) => ({
        ...row,
        enabled: this.enabled(row.runtimeId),
        additionalArgs: [
          ...(this.#state.additionalArgs?.[row.runtimeId] ?? []),
        ],
        defaultArgs: providerLaunchDefaults(row.runtimeId),
        requiredArgs: providerLaunchRequiredArgs(row.runtimeId),
        managedLaunch: providerLaunchPolicy(row.runtimeId),
        overrideArgs: this.#state.overrides?.[row.runtimeId]
          ? [...this.#state.overrides[row.runtimeId]!]
          : null,
        effectiveArgs: [
          ...(this.#state.overrides?.[row.runtimeId] ?? [
            ...providerLaunchDefaults(row.runtimeId),
            ...(this.#state.additionalArgs?.[row.runtimeId] ?? []),
          ]),
        ],
      })),
    };
  }
  update(raw: RuntimeGuideUpdate): RuntimeGuideSettingsView {
    const input = RuntimeGuideUpdateSchema.parse(raw);
    if (input.expectedRevision !== this.#state.revision)
      throw new ConflictError(
        "Guide settings revision changed; reload settings",
      );
    if (
      input.enabled &&
      !capabilities.find((row) => row.runtimeId === input.runtimeId)?.supported
    )
      throw new ConflictError("Guide unavailable for this runtime adapter");
    const enabled = this.#state.enabled.filter(
      (id) => input.enabled === undefined || id !== input.runtimeId,
    );
    const additionalArgs = {
      codex: [],
      claude: [],
      kimi: [],
      opencode: [],
      ...this.#state.additionalArgs,
    };
    const overrides = {
      codex: null,
      claude: null,
      kimi: null,
      opencode: null,
      ...this.#state.overrides,
    } as Record<"codex" | "claude" | "kimi" | "opencode", string[] | null>;
    if (input.overrideArgs !== undefined) {
      try {
        overrides[input.runtimeId] =
          input.overrideArgs === null
            ? null
            : validateProviderLaunchOverride(
                input.runtimeId,
                input.overrideArgs,
              );
      } catch (error) {
        throw new ConflictError(
          error instanceof Error ? error.message : "Invalid provider override",
        );
      }
      additionalArgs[input.runtimeId] = [];
    }
    if (input.additionalArgs !== undefined) {
      overrides[input.runtimeId] = null;
      try {
        additionalArgs[input.runtimeId] = validateProviderLaunchArgs(
          input.additionalArgs,
        );
      } catch (error) {
        throw new ConflictError(
          error instanceof Error ? error.message : "Invalid provider arguments",
        );
      }
    }
    if (
      input.enabled &&
      (input.runtimeId === "codex" || input.runtimeId === "claude")
    )
      enabled.push(input.runtimeId);
    const next = State.parse({
      revision: this.#state.revision + 1,
      enabled,
      additionalArgs,
      overrides,
    });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(next), {
        mode: 0o600,
        flag: "wx",
      });
      const fd = openSync(temporary, "r");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.path);
      this.#state = next;
      const directory = openSync(dirname(this.path), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      rmSync(temporary, { force: true });
    }
    return this.read();
  }
}
