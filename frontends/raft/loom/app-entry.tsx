import { initializeDeviceRegion } from "./region-runtime.ts";
import PreviewHosts from "./PreviewHosts.tsx";
import ReactDOM from "react-dom/client";
import { AppProviders } from "../packages/web/src/AppProviders.tsx";
import { LoomRouter, DraftNavigation } from "./DraftNavigation.tsx";
import ChannelApp from "./ChannelApp.tsx";
initializeDeviceRegion();
document.title = "Loom";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppProviders router={LoomRouter}>
    <DraftNavigation>
      <ChannelApp />
      <PreviewHosts />
    </DraftNavigation>
  </AppProviders>,
);
