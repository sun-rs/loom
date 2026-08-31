import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";

export function mountRahApp(): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("RAH OS Web root is missing");

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
