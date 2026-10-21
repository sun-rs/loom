import { adaptMobileMessageDefault } from "./mobile-message-default.ts";
import { pushWorkerPlugin } from "./push-worker-plugin.ts";
import { adaptChineseLocale } from "./locale-adaptation.ts";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { localizeFontCss } from "./local-fonts.ts";
import { officialUiAliases } from "./ui-resolution.ts";

import { defineConfig } from "vite";
import { resolve } from "node:path";
import officialConfig from "../packages/web/vite.config.ts";
import { webBuildDefines, webBuildMetadataPlugin } from "./release-plugin.ts";

// Official presentation with Loom's existing release provenance contract.
export default defineConfig({
  ...officialConfig,
  define: { ...officialConfig.define, ...webBuildDefines },
  css: {
    ...officialConfig.css,
    postcss: {
      plugins: [
        tailwindcss(),
        {
          postcssPlugin: "loom-local-font-delivery",
          OnceExit(root) {
            const localized = localizeFontCss(root.toString());
            root
              .removeAll()
              .append(
                postcss.parse(localized, { from: root.source?.input.file }),
              );
          },
        },
      ],
    },
  },
  resolve: { ...officialConfig.resolve, alias: officialUiAliases() },
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
        if (id.endsWith("/store/appearanceStore.ts"))
          return { code: adaptMobileMessageDefault(code), map: null };
        if (id.endsWith("/packages/web/src/i18n/LocaleProvider.tsx"))
          return { code: adaptChineseLocale(code), map: null };
      },
      resolveId(source, importer) {
        if (source === "loom-message-profile")
          return resolve(import.meta.dirname, "MessageProfile.tsx");
        if (source === "loom-composer-directory")
          return resolve(import.meta.dirname, "ComposerDirectory.tsx");
        if (source === "loom-reactions")
          return resolve(import.meta.dirname, "MessageReactions.tsx");
        if (
          importer?.endsWith("/components/member/GravatarAvatar.tsx") &&
          source === "../../utils/humanAvatar"
        )
          return resolve(import.meta.dirname, "profile-avatar.ts");
        if (source === "loom-attachment-comments")
          return resolve(import.meta.dirname, "useAttachmentComments.tsx");
        if (source === "loom-appearance")
          return resolve(import.meta.dirname, "AppearanceRuntime.tsx");
        if (source === "loom-composer-files")
          return resolve(import.meta.dirname, "ComposerFiles.tsx");
        if (source === "loom-attachments")
          return resolve(import.meta.dirname, "Attachments.tsx");
        if (source === "loom-channel-tasks")
          return resolve(import.meta.dirname, "ChannelTasks.tsx");
        if (source === "loom-thread-followers")
          return resolve(import.meta.dirname, "ThreadFollowers.tsx");
        if (source === "loom-thread-toolbar")
          return resolve(import.meta.dirname, "ThreadToolbar.tsx");
        if (
          importer?.includes("/packages/web/src/components/message/") &&
          /(?:^|\/)ProfilePreviewCardContent(?:\.tsx)?$/.test(source)
        )
          return resolve(import.meta.dirname, "MessageProfile.tsx");
        if (
          /\/packages\/web\/src\/components\/message\/MessageInput\.tsx$/.test(
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
    pushWorkerPlugin(),
  ],
  build: { ...officialConfig.build, outDir: "dist-workbench" },
});
