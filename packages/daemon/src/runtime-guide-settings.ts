import {
  AgentLaunchOverlaySchema,
  LaunchOverlaysSchema,
  mergeLaunchArguments,
} from "./runtime-launch-overlays.ts";
import {
  PROVIDER_LAUNCH_ARGS_ENV,
  providerLaunchDefaults,
  providerLaunchRequiredArgs,
  providerLaunchPolicy,
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
  RuntimeLaunchEnvironmentSchema,
  type RuntimeGuideRead,
  type RuntimeGuideUpdate,
  type RuntimeGuideSettingsView,
} from "@rah-os/protocol";

const State = z
  .object({
    revision: z.number().int().nonnegative(),
    environment: z
      .record(z.string(), RuntimeLaunchEnvironmentSchema)
      .optional(),
    agents: LaunchOverlaysSchema.optional(),
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
      launchEnvironment: (runtimeId: string, agentId?: string) => {
        const row = this.read(agentId ? { agentId } : {}).runtimes.find(
          (r) => r.runtimeId === runtimeId,
        );
        return {
          ...row?.inheritedEnvironment,
          ...row?.environment,
          [PROVIDER_LAUNCH_ARGS_ENV]: JSON.stringify({
            runtimeId,
            overrideArgs: row?.overrideArgs ?? null,
            additionalArgs: mergeLaunchArguments(
              row?.inheritedArgs ?? [],
              row?.additionalArgs ?? [],
            ),
          }),
        };
      },
    };
  }
  read(scope: RuntimeGuideRead = {}): RuntimeGuideSettingsView {
    return {
      revision: this.#state.revision,
      runtimes: capabilities.map((row) => ({
        ...row,
        enabled: this.enabled(row.runtimeId),
        additionalArgs: [],
        environment: scope.agentId
          ? {
              ...this.#state.agents?.[scope.agentId]?.[row.runtimeId]
                ?.environment,
            }
          : {},
        inheritedArgs: [],
        inheritedEnvironment: {},
        defaultArgs: providerLaunchDefaults(row.runtimeId),
        requiredArgs: providerLaunchRequiredArgs(row.runtimeId),
        managedLaunch: providerLaunchPolicy(row.runtimeId),
        overrideArgs: null,
        effectiveArgs: providerLaunchDefaults(row.runtimeId),
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
      !input.agentId &&
      (input.enabled === undefined ||
        input.environment !== undefined ||
        input.additionalArgs !== undefined ||
        input.overrideArgs !== undefined)
    )
      throw new ConflictError(
        "Provider settings are read-only; configure launch settings on an Agent",
      );
    if (input.agentId && input.additionalArgs !== undefined)
      throw new ConflictError(
        "Agent configuration supports environment variables only",
      );
    const agents = structuredClone(this.#state.agents ?? {});
    const enabled = [...this.#state.enabled];
    if (input.agentId) {
      const perAgent = agents[input.agentId] ?? {};
      perAgent[input.runtimeId] = AgentLaunchOverlaySchema.parse({
        additionalArgs:
          input.additionalArgs === undefined
            ? (perAgent[input.runtimeId]?.additionalArgs ?? [])
            : mergeLaunchArguments([], input.additionalArgs),
        environment:
          input.environment ?? perAgent[input.runtimeId]?.environment ?? {},
      });
      agents[input.agentId] = perAgent;
    } else {
      if (
        !capabilities.find((row) => row.runtimeId === input.runtimeId)
          ?.supported
      )
        throw new ConflictError("Guide unavailable for this runtime adapter");
      const id = input.runtimeId as "codex" | "claude";
      const index = enabled.indexOf(id);
      if (index >= 0) enabled.splice(index, 1);
      if (input.enabled) enabled.push(id);
    }
    // Retain retired global fields for disk compatibility, never apply them.
    const next = State.parse({
      ...this.#state,
      revision: this.#state.revision + 1,
      agents,
      enabled,
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
    return this.read(input.agentId ? { agentId: input.agentId } : {});
  }
}
