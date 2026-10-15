import { adaptMessageProfileNavigation } from "./message-profile-navigation.ts";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import officialConfig from "../packages/web/vite.config.ts";
import { webBuildDefines, webBuildMetadataPlugin } from "./release-plugin.ts";

// Official presentation with Loom's existing release provenance contract.
export default defineConfig({
  ...officialConfig,
  define: { ...officialConfig.define, ...webBuildDefines },
  plugins: [
    {
      name: "loom-entry",
      enforce: "pre",
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html.replace(
            "/src/main.tsx",
            "/@fs" + resolve(import.meta.dirname, "main.tsx"),
          ),
      },
      transform(code, id) {
        if (id.endsWith("/packages/web/src/components/message/MessageItem.tsx"))
          return { code: adaptMessageProfileNavigation(code), map: null };
      },
      resolveId(source, importer) {
        if (
          importer?.includes("/packages/web/src/components/message/") &&
          /(?:^|\/)ProfilePreviewCardContent(?:\.tsx)?$/.test(source)
        )
          return resolve(import.meta.dirname, "MessageProfile.tsx");
        if (
          /\/packages\/web\/src\/components\/message\/(MessageInput|MessageItem)\.tsx$/.test(
            importer ?? "",
          ) &&
          /(?:^|\/)ui\/AvatarSlot(?:\.tsx)?$/.test(source)
        )
          return resolve(import.meta.dirname, "MentionAvatar.tsx");
        if (
          importer &&
          /(?:^|\/)api\/client(?:\.ts)?$/.test(source) &&
          importer.includes("/packages/web/src/")
        )
          return resolve(import.meta.dirname, "upstream-api.ts");
      },
    },
    ...(officialConfig.plugins ?? []),
    webBuildMetadataPlugin("build"),
  ],
  build: { ...officialConfig.build, outDir: "dist-workbench" },
});
