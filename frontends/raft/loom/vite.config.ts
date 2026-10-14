import { defineConfig } from "vite";
import officialConfig from "../packages/web/vite.config.ts";
import { webBuildDefines, webBuildMetadataPlugin } from "./release-plugin.ts";

// Official presentation with Loom's existing release provenance contract.
export default defineConfig({
  ...officialConfig,
  define: { ...officialConfig.define, ...webBuildDefines },
  plugins: [...(officialConfig.plugins ?? []), webBuildMetadataPlugin("build")],
  build: { ...officialConfig.build, outDir: "dist-workbench" },
});
