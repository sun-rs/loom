import { defineConfig } from "vite";

// Throwaway evo console (docs/evo/status.zh-CN.md §44), deleted in phase 4.
// Served by LocalWorkbenchGateway at /_rah/console/; one entry, no inline script.
export default defineConfig({
  base: "/_rah/console/",
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: { input: "index.html" },
  },
});
