import "@rah-os/ui-tokens/styles.css";
import "@rah-os/ui-tokens/channel-extras.css";
import "@rah-os/ui-tokens/computers.css";
import "@rah-os/ui-tokens/members.css";
import "@rah-os/ui-tokens/overlays.css";
import "@rah-os/ui-tokens/tasks.css";
import "@rah-os/ui-tokens/activity.css";
import "@rah-os/ui-tokens/search.css";
import "./interaction-state.css";
import "./product.css";
import "./agent-directory.css";
import "./computer-directory.css";
import "./global-discovery.css";
import "./discovery-controls.css";
import "./identity-interactions.css";
import "./chat-surface.css";
import "./message-social.css";
import "./room-files.css";
import { applySettingsPreferences } from "./settings-preferences.ts";

// The production gateways deliberately omit `unsafe-eval`. Zod's optional
// object-parser JIT probes `Function("")` during module evaluation unless its
// shared global configuration is already jitless. Set that flag before the
// dynamic application import so Firefox never observes a caught CSP violation.
// Importing Zod here first would be too late: its module body performs the
// probe before `z.config(...)` can run.
const zodGlobal = globalThis as typeof globalThis & {
  __zod_globalConfig?: Record<string, unknown>;
};
zodGlobal.__zod_globalConfig = {
  ...zodGlobal.__zod_globalConfig,
  jitless: true,
};

applySettingsPreferences(window.localStorage);

void import("./mount-app.tsx").then(({ mountRahApp }) => mountRahApp());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (
      event.data?.type !== "RAH_PUSH_NOTIFICATION_NAVIGATE" ||
      typeof event.data.url !== "string"
    )
      return;
    const target = new URL(event.data.url, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname !== "/")
      return;
    void import("./push-navigation.ts").then(({ pushTargetFromSearch }) => {
      const navigationTarget = pushTargetFromSearch(target.search);
      if (navigationTarget)
        window.dispatchEvent(
          new CustomEvent("rah:push-navigate", { detail: navigationTarget }),
        );
    });
  });
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
