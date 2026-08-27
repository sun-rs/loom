import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@rah-os/ui-tokens/styles.css";
import "@rah-os/ui-tokens/channel-extras.css";
import "./product.css";

import { App } from "./App.tsx";

const root = document.getElementById("root");
if (root === null) throw new Error("RAH OS Web root is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
