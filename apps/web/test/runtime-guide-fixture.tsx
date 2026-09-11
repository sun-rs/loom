import { createRoot } from "react-dom/client";
import type { RahClient } from "@rah-os/client-sdk";
import { SettingsSurface } from "../src/components/settings-surface.tsx";
import "../src/product-styles.ts";
let revision = 0;
let enabled = false;
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
  ],
});
const client = {
  async request(command: string, input: { enabled?: boolean }) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (command === "runtime.guide.update") {
      enabled = input.enabled === true;
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
