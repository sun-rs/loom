import { createRoot } from "react-dom/client";
import type { RahClient } from "@rah-os/client-sdk";
import { SettingsSurface } from "../src/components/settings-surface.tsx";
import "../src/product-styles.ts";
const longLaunch = new URLSearchParams(location.search).has("longLaunch");
let revision = 0;
const enabled = new Set(["codex", "claude"]);
const client = {
  async request(
    command: string,
    input: { runtimeId?: string; enabled?: boolean; expectedRevision?: number },
  ) {
    if (command === "runtime.guide.update") {
      if (
        Object.keys(input).some(
          (key) => !["runtimeId", "enabled", "expectedRevision"].includes(key),
        )
      )
        throw new Error("Global launch writes forbidden");
      if (
        input.expectedRevision !== revision ||
        !["codex", "claude"].includes(input.runtimeId ?? "")
      )
        throw new Error("Invalid Guide update");
      if (input.enabled) enabled.add(input.runtimeId!);
      else enabled.delete(input.runtimeId!);
      revision++;
    } else if (command !== "runtime.guide.read")
      throw new Error("Unexpected command");
    return {
      revision,
      runtimes: ["codex", "claude", "kimi", "opencode"].map((runtimeId) => ({
        runtimeId,
        enabled: enabled.has(runtimeId),
        supported: ["codex", "claude"].includes(runtimeId),
        detail: "Fixture",
        additionalArgs: [],
        environment: {},
        inheritedArgs: [],
        inheritedEnvironment: {},
        managedLaunch: {
          args: [],
          environment:
            runtimeId === "claude"
              ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }
              : {},
        },
        defaultArgs:
          runtimeId === "codex"
            ? [
                "app-server",
                ...(longLaunch
                  ? Array.from(
                      { length: 20 },
                      (_, i) => `--fixture-option-${i}=${"x".repeat(80)}`,
                    )
                  : []),
              ]
            : [],
        requiredArgs: [],
        effectiveArgs: [],
        overrideArgs: null,
      })),
    };
  },
} as unknown as RahClient;
createRoot(document.getElementById("root")!).render(
  <main
    style={{
      height: "100vh",
      display: "flex",
      gridTemplateColumns: "0 minmax(0, 1fr) 0",
      gridTemplateRows: "minmax(0, 1fr)",
    }}
  >
    <SettingsSurface
      client={client}
      agents={[]}
      canManageWorkspace={false}
      currentPrincipal={undefined}
      workspace={undefined}
      onWorkspaceUpdated={() => {}}
      onPrincipalUpdated={() => {}}
    />
  </main>,
);
