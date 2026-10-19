import { initializeDeviceRegion } from "./region-runtime.ts";
import HtmlPreview from "./HtmlPreview.tsx";
import DocumentPreview from "./DocumentPreview.tsx";
import ImageLightbox from "../packages/web/src/components/ImageLightbox.tsx";
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
      <ImageLightbox />
      <DocumentPreview />
      <HtmlPreview />
    </DraftNavigation>
  </AppProviders>,
);
