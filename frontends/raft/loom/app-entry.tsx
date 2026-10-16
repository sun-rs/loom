import DocumentPreview from "./DocumentPreview.tsx";
import ImageLightbox from "../packages/web/src/components/ImageLightbox.tsx";
import ReactDOM from "react-dom/client";
import { AppProviders } from "../packages/web/src/AppProviders.tsx";
import ChannelApp from "./ChannelApp.tsx";
document.title = "Loom";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppProviders>
    <ChannelApp />
    <ImageLightbox />
    <DocumentPreview />
  </AppProviders>,
);
