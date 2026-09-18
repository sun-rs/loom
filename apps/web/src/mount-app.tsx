import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { SurfaceErrorBoundary } from "./components/surface-error-boundary.tsx";
import { SURFACE_ROOT_ERROR_OPTIONS } from "./components/surface-error-boundary-diagnostic.ts";

export function mountRahApp(): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("RAH OS Web root is missing");

  createRoot(root, SURFACE_ROOT_ERROR_OPTIONS).render(
    <StrictMode>
      <SurfaceErrorBoundary surface="工作台">
        <App />
      </SurfaceErrorBoundary>
    </StrictMode>,
  );
}
