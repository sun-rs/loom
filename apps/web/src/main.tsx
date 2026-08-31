import { z } from "zod";

import "@rah-os/ui-tokens/styles.css";
import "@rah-os/ui-tokens/channel-extras.css";
import "@rah-os/ui-tokens/computers.css";
import "@rah-os/ui-tokens/members.css";
import "@rah-os/ui-tokens/overlays.css";
import "@rah-os/ui-tokens/tasks.css";
import "@rah-os/ui-tokens/activity.css";
import "@rah-os/ui-tokens/search.css";
import "./product.css";
import "./agent-directory.css";
import "./computer-directory.css";
import "./global-discovery.css";
import "./discovery-controls.css";
import "./identity-interactions.css";
import "./room-files.css";

// The production gateways deliberately omit `unsafe-eval`. Zod's optional
// object-parser JIT probes `Function("")` unless jitless mode is selected,
// which Firefox reports as a CSP violation even though Zod catches it. App
// and protocol modules are intentionally loaded only after this global flag.
z.config({ jitless: true });

void import("./mount-app.tsx").then(({ mountRahApp }) => mountRahApp());

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
