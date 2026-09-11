import { createRoot } from "react-dom/client";
import type { RahClient } from "@rah-os/client-sdk";
import { SettingsSurface } from "../src/components/settings-surface.tsx";
import "../src/product-styles.ts";
let revision = 0;
let enabled = false;
const additions: Record<string, string[]> = {};
const overrides: Record<string, string[] | null> = {};
const defaults = ["serve", "--pure"];
const view = () => ({
  revision,
  runtimes: [
    { runtimeId: "codex", enabled, supported: true, detail: "Fixture — Codex" },
    {
      runtimeId: "claude",
      enabled: false,
      supported: true,
      detail: "Fixture — Claude",
    },
    {
      runtimeId: "kimi",
      enabled: false,
      supported: false,
      detail: "Fixture — ACP 未接通 Guide",
    },
    {
      runtimeId: "opencode",
      enabled: false,
      supported: false,
      detail: "Fixture — 未接通 Guide",
    },
  ].map((row) => ({
    ...row,
    additionalArgs: additions[row.runtimeId] ?? [],
    managedLaunch: { args: [], environment: {} },
    defaultArgs: defaults,
    requiredArgs: ["serve"],
    effectiveArgs: overrides[row.runtimeId] ?? defaults,
    overrideArgs: overrides[row.runtimeId] ?? null,
  })),
});
const client = {
  async request(
    command: string,
    input: {
      enabled?: boolean;
      runtimeId: string;
      overrideArgs?: string[] | null;
      additionalArgs?: string[];
    },
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (command === "runtime.guide.update") {
      if (input.enabled !== undefined) enabled = input.enabled;
      if (input.overrideArgs !== undefined)
        overrides[input.runtimeId] = input.overrideArgs;
      if (input.additionalArgs !== undefined) {
        additions[input.runtimeId] = input.additionalArgs;
        overrides[input.runtimeId] = null;
      }
      revision++;
    }
    return view();
  },
} as unknown as RahClient;
createRoot(document.getElementById("root")!).render(
  <main style={{ height: "100vh" }}>
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
