import ReactDOM from "react-dom/client";
import { AppProviders } from "../packages/web/src/AppProviders.tsx";
import ChannelApp from "./ChannelApp.tsx";
import "./style.css";
document.title = "Loom";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppProviders>
    <ChannelApp />
  </AppProviders>,
);
