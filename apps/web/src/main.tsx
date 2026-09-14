import "./product-styles.ts";
import { applySettingsPreferences } from "./settings-preferences.ts";
import {
  currentWebBuildId,
  installWebBuildRecovery,
  requestWebBuildRefresh,
} from "./web-build-recovery.ts";

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

const webBuildRecovery = installWebBuildRecovery(currentWebBuildId());
// A slow version probe must never prevent the application from mounting.
void webBuildRecovery.probe();
void import("./mount-app.tsx")
  .then(({ mountRahApp }) => mountRahApp())
  .catch((error: unknown) => {
    if (!requestWebBuildRefresh(error, "later_action")) throw error;
  });

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
