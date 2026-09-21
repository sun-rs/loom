import { createRoot } from "react-dom/client";
import type { RahClient } from "@rah-os/client-sdk";
import { LanguageRegionSettingsContent } from "../src/components/settings-pages.tsx";
import { WorkbenchServiceRestart } from "../src/components/workbench-service-restart.tsx";
import { WebPushSettingsContent } from "../src/components/web-push-settings.tsx";
import "../src/product-styles.ts";
const mode = new URLSearchParams(location.search).get("mode");
const client = {
  async request(command: string) {
    if (command === "push.configuration")
      return { supported: true, subscriptionCount: 1 };
    if (command === "push.test") {
      document.body.dataset.pushTest = "accepted";
      return { delivered: 1 };
    }
    throw new Error("Fixture unexpected command");
  },
} as unknown as RahClient;
createRoot(document.getElementById("root")!).render(
  mode === "restart" ? (
    <WorkbenchServiceRestart />
  ) : mode === "push" ? (
    <WebPushSettingsContent client={client} workspaceId={undefined} />
  ) : (
    <LanguageRegionSettingsContent />
  ),
);
