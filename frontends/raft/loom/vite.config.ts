import { adaptSystemSettings } from "./system-settings-adaptation.ts";
import { adaptArchivedChannels } from "./settings-archive-adaptation.ts";
import { adaptTaskCreation } from "./task-create-adaptation.ts";
import { officialUiAliases } from "./ui-resolution.ts";
import {
  exposeAppearance,
  adaptMessageModelLabel,
} from "./appearance-adaptation.ts";
import {
  adaptAttachmentComposer,
  adaptAttachmentMessage,
  adaptAttachmentComments,
} from "./attachment-adaptation.ts";
import {
  adaptTaskComposer,
  adaptTaskMessage,
} from "./channel-task-adaptation.ts";
import { exposeTaskPresentation, adaptTaskCard } from "./task-adaptation.ts";
import {
  adaptThreadItem,
  adaptThreadFooter,
  adaptComposerSubmit,
} from "./thread-adaptation.ts";
import { adaptMessageProfileNavigation } from "./message-profile-navigation.ts";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import officialConfig from "../packages/web/vite.config.ts";
import { webBuildDefines, webBuildMetadataPlugin } from "./release-plugin.ts";

// Official presentation with Loom's existing release provenance contract.
export default defineConfig({
  ...officialConfig,
  define: { ...officialConfig.define, ...webBuildDefines },
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
        if (
          id.endsWith(
            "/packages/web/src/components/settings/ArchivedChannelsSection.tsx",
          )
        )
          return { code: adaptArchivedChannels(code), map: null };
        if (
          id.endsWith("/packages/web/src/components/task/CreateTaskDialog.tsx")
        )
          return { code: adaptTaskCreation(code), map: null };
        if (
          id.endsWith(
            "/packages/web/src/components/message/AttachmentCommentsPanel.tsx",
          )
        )
          return { code: adaptAttachmentComments(code), map: null };
        if (
          id.endsWith("/packages/web/src/components/settings/SettingsPanel.tsx")
        )
          return {
            code: exposeAppearance(adaptSystemSettings(code)),
            map: null,
          };
        if (id.endsWith("/packages/web/src/components/task/TaskCard.tsx"))
          return { code: adaptTaskCard(code), map: null };
        if (id.endsWith("/packages/web/src/components/task/TasksPanel.tsx"))
          return { code: exposeTaskPresentation(code), map: null };
        if (
          id.endsWith("/packages/web/src/components/message/MessageInput.tsx")
        )
          return {
            code: adaptAttachmentComposer(
              adaptTaskComposer(adaptComposerSubmit(code)),
            ),
            map: null,
          };
        if (id.endsWith("/packages/web/src/components/message/ThreadPanel.tsx"))
          return { code: adaptThreadFooter(code), map: null };
        if (id.endsWith("/packages/web/src/components/message/MessageItem.tsx"))
          return {
            code: adaptAttachmentMessage(
              adaptTaskMessage(
                adaptThreadItem(
                  adaptMessageModelLabel(adaptMessageProfileNavigation(code)),
                ),
              ),
            ),
            map: null,
          };
      },
      resolveId(source, importer) {
        if (source === "loom-system-settings")
          return resolve(import.meta.dirname, "SystemSettings.tsx");
        if (source === "loom-archived-settings")
          return resolve(import.meta.dirname, "ArchivedSettings.tsx");
        if (source === "loom-native-archived-channels")
          return resolve(
            import.meta.dirname,
            "../packages/web/src/components/settings/ArchivedChannelsSection.tsx",
          );
        if (source === "loom-task-create")
          return resolve(import.meta.dirname, "TaskCreate.tsx");
        if (source === "loom-attachment-comments")
          return resolve(import.meta.dirname, "useAttachmentComments.tsx");
        if (
          importer?.endsWith("/components/search/SearchOverlay.tsx") &&
          source === "./MessageSearchPage"
        )
          return resolve(import.meta.dirname, "SearchOverlayContent.tsx");
        if (source === "loom-native-appearance")
          return resolve(
            import.meta.dirname,
            "../packages/web/src/components/settings/SettingsPanel.tsx",
          );
        if (source === "loom-appearance")
          return resolve(import.meta.dirname, "AppearanceRuntime.tsx");
        if (source === "loom-composer-files")
          return resolve(import.meta.dirname, "ComposerFiles.tsx");
        if (source === "loom-attachments")
          return resolve(import.meta.dirname, "Attachments.tsx");
        if (source === "loom-channel-tasks")
          return resolve(import.meta.dirname, "ChannelTasks.tsx");
        if (
          importer?.endsWith("/components/task/TaskModalHead.tsx") &&
          source === "./TaskProperties"
        )
          return resolve(import.meta.dirname, "TaskProperties.tsx");
        if (source === "loom-thread-toolbar")
          return resolve(import.meta.dirname, "ThreadToolbar.tsx");
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
