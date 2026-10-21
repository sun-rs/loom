import { adaptMessageStatus } from "./message-status-adaptation.ts";
import { adaptMobileMessageDefault } from "./mobile-message-default.ts";
import { pushWorkerPlugin } from "./push-worker-plugin.ts";
import { adaptComposerDirectory } from "./composer-directory-adaptation.ts";
import { adaptTimelineWindow } from "./timeline-window-adaptation.ts";
import { adaptChineseLocale } from "./locale-adaptation.ts";
import { adaptReactions, adaptReactionToolbar } from "./reaction-adaptation.ts";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { localizeFontCss } from "./local-fonts.ts";
import {
  adaptThreadFollowers,
  adaptThreadFollowerRow,
} from "./thread-followers-adaptation.ts";
import { adaptTaskCreation } from "./task-create-adaptation.ts";
import { officialUiAliases } from "./ui-resolution.ts";
import { adaptMessageModelLabel } from "./appearance-adaptation.ts";
import {
  adaptAttachmentComposer,
  adaptAttachmentMessage,
  adaptAttachmentComments,
  adaptPdfComments,
} from "./attachment-adaptation.ts";
import {
  adaptTaskComposer,
  adaptTaskMessage,
} from "./channel-task-adaptation.ts";
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
        if (id.endsWith("/components/message/MentionLink.tsx")) {
          const needle =
            "const viewerUserId = useAuthStore((s) => s.user?.id ?? null);";
          if (!code.includes(needle))
            throw new Error("Official MentionLink viewer seam changed");
          return {
            code:
              'import { useMessageViewerId } from "loom-composer-directory";\n' +
              code.replace(
                needle,
                "const viewerUserId = useMessageViewerId();",
              ),
            map: null,
          };
        }
        if (id.endsWith("/components/message/MessageTimeline.tsx"))
          return { code: adaptTimelineWindow(code), map: null };
        if (id.endsWith("/packages/web/src/i18n/LocaleProvider.tsx"))
          return { code: adaptChineseLocale(code), map: null };
        if (id.endsWith("/components/message/MessageHoverToolbar.tsx"))
          return { code: adaptReactionToolbar(code), map: null };

        if (
          id.endsWith(
            "/packages/web/src/components/thread/ThreadAgentFollowers.tsx",
          )
        )
          return { code: adaptThreadFollowers(code), map: null };
        if (
          id.endsWith(
            "/packages/web/src/components/thread/ThreadAgentFollowerRow.tsx",
          )
        )
          return { code: adaptThreadFollowerRow(code), map: null };
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
          id.endsWith(
            "/packages/web/src/components/message/attachmentPreviewSurfaces.tsx",
          )
        )
          return { code: adaptPdfComments(code), map: null };
        if (
          id.endsWith("/packages/web/src/components/message/MessageInput.tsx")
        )
          return {
            code: adaptAttachmentComposer(
              adaptComposerDirectory(
                adaptTaskComposer(adaptComposerSubmit(code)),
              ),
            ),
            map: null,
          };
        if (id.endsWith("/packages/web/src/components/message/ThreadPanel.tsx"))
          return { code: adaptThreadFooter(code), map: null };
        if (
          id.endsWith("/packages/web/src/components/message/MessageItem.tsx")
        ) {
          const mentionSeam =
            "const effectiveMentionMap = isExternal ? EXTERNAL_MESSAGE_MENTION_MAP : mentionMap;";
          if (code.split(mentionSeam).length !== 2)
            throw new Error("Official mention identity seam changed");
          code =
            'import { boundMessageMentions } from "loom-message-profile";\n' +
            code.replace(
              mentionSeam,
              "const boundMentionMap = useMemo(() => boundMessageMentions(mentionMap, message.mentions), [mentionMap, message.mentions]);\n  const effectiveMentionMap = isExternal ? EXTERNAL_MESSAGE_MENTION_MAP : readOnlyProjection ? boundMentionMap : mentionMap;",
            );
          return {
            code: adaptReactions(
              adaptAttachmentMessage(
                adaptTaskMessage(
                  adaptThreadItem(
                    adaptMessageModelLabel(
                      adaptMessageStatus(adaptMessageProfileNavigation(code)),
                    ),
                  ),
                ),
              ),
            ),
            map: null,
          };
        }
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
        if (source === "loom-task-create")
          return resolve(import.meta.dirname, "TaskCreate.tsx");
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
