import { AgentModelMessagesFixture } from "./agent-model-messages-fixture.tsx";
import { applySettingsPreferences } from "../src/settings-preferences.ts";
import { Rail } from "../src/components/workspace-navigation.tsx";
import { createRoot } from "react-dom/client";
import {
  AppearanceSettingsContent,
  AboutSettingsContent,
} from "../src/components/settings-pages.tsx";
import "../src/product-styles.ts";
applySettingsPreferences(window.localStorage);
const about = new URLSearchParams(location.search).has("about");
createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh", overflow: "auto", display: "flex" }}>
    <aside style={{ width: 64, flexShrink: 0, paddingTop: 16 }}>
      <Rail onSelect={() => {}} onTasks={() => {}} onNotifications={() => {}} />
    </aside>
    <main style={{ flex: 1, minWidth: 0 }}>
      {about ? (
        <AboutSettingsContent
          workspace={{
            workspaceId: "fixture",
            controlRoomId: "fixture-room",
            name: "Fixture Workspace",
            slug: "fixture",
            createdAt: "2026-09-10T00:00:00Z",
          }}
        />
      ) : (
        <AppearanceSettingsContent />
      )}
      {new URLSearchParams(location.search).has("modelMessages") ? (
        <AgentModelMessagesFixture />
      ) : null}
    </main>
  </div>,
);
