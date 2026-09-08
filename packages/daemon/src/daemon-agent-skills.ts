import { homedir } from "node:os";
import {
  scanAgentSkills,
  unavailableAgentSkills,
} from "../../agent-host/src/agent-skills.ts";
import type { AgentMemoryCoordinator } from "@rah-os/agent-host";
import type {
  AgentSkillsList,
  ExecutionPolicyRevision,
  RuntimeProfileRevision,
  RuntimeProfileProbeReport,
} from "@rah-os/protocol";
import type { ConfiguredLocalRuntimeSnapshot } from "./local-runtime-inventory.ts";

export type SkillsConfiguration = {
  known: boolean;
  home: string;
  codexHome?: string;
  claudeConfigDirectory?: string;
};
const HOME_VARIABLES = new Set(["HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"]);
/** Same inherited/static precedence as GenericProcessAdapter; never resolves secrets. */
export function resolveSkillsConfiguration(
  revision: RuntimeProfileRevision,
  probe: RuntimeProfileProbeReport,
  inherited: NodeJS.ProcessEnv = process.env,
): SkillsConfiguration {
  const manifest = revision.manifest;
  const env = {
    ...inherited,
    ...(manifest.manifestVersion === 1 ? {} : manifest.staticEnv),
  };
  const dynamicHome =
    manifest.manifestVersion !== 1 &&
    manifest.credentialSlots.some((slot) =>
      HOME_VARIABLES.has(slot.target.variable),
    );
  const modelHome =
    probe.reportVersion === 2 &&
    probe.modelBindings.some((binding) => {
      const variable = binding.adapterMapping.config.reasoningEnvironment;
      return (
        Array.isArray(variable) && HOME_VARIABLES.has(variable[0] as string)
      );
    });
  return {
    known: !dynamicHome && !modelHome,
    home: env.HOME ?? homedir(),
    ...(env.CODEX_HOME ? { codexHome: env.CODEX_HOME } : {}),
    ...(env.CLAUDE_CONFIG_DIR
      ? { claudeConfigDirectory: env.CLAUDE_CONFIG_DIR }
      : {}),
  };
}

export function createDaemonAgentSkillsReader(input: {
  coordinator: Pick<AgentMemoryCoordinator, "workspaceRoots">;
  configured: readonly ConfiguredLocalRuntimeSnapshot[];
  scan?: typeof scanAgentSkills;
}): (
  owner: string,
  policy: ExecutionPolicyRevision,
) => Promise<AgentSkillsList> {
  return async (owner, policy) => {
    const ids = policy.required.allowedOfferIds;
    const runtime =
      ids?.length === 1
        ? input.configured.find((entry) => entry.runtimeOfferId === ids[0])
        : undefined;
    const base = {
      executionPolicyRevisionId: policy.executionPolicyRevisionId,
      ...(runtime ? { runtimeOfferId: runtime.runtimeOfferId } : {}),
      ...(runtime?.cliId ? { cliId: runtime.cliId } : {}),
    };
    const unavailable = (
      issue: Parameters<typeof unavailableAgentSkills>[0],
    ): AgentSkillsList => ({
      ...base,
      global: unavailableAgentSkills(issue),
      workspace: unavailableAgentSkills(issue),
    });
    if (!runtime?.cliId) return unavailable("unresolved_runtime");
    if (!["claude", "codex"].includes(runtime.cliId))
      return unavailable("unsupported_runtime");
    if (!runtime.skillsConfiguration?.known)
      return unavailable("unresolved_home");
    const root = (await input.coordinator.workspaceRoots(owner)).roots.find(
      (root) => root.rootId === "agent-workspace",
    );
    if (!root) return unavailable("unresolved_home");
    const { known: _known, ...configuration } = runtime.skillsConfiguration;
    return {
      ...base,
      ...(await (input.scan ?? scanAgentSkills)({
        cliId: runtime.cliId,
        ...configuration,
        workspaceRoot: root.rootPath,
      })),
    };
  };
}
