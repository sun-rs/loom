import { adaptMessageModelLabel } from "../../frontends/raft/loom/appearance-adaptation.ts";
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptAttachmentComments,
  adaptPdfComments,
} from "../../frontends/raft/loom/attachment-adaptation.ts";
import { adaptMessageStatus } from "../../frontends/raft/loom/message-status-adaptation.ts";
import { adaptMessageProfileNavigation } from "../../frontends/raft/loom/message-profile-navigation.ts";
import { adaptReactions } from "../../frontends/raft/loom/reaction-adaptation.ts";
import {
  adaptTaskComposer,
  adaptTaskMessage,
} from "../../frontends/raft/loom/channel-task-adaptation.ts";
import {
  adaptThreadItem,
  adaptComposerSubmit,
} from "../../frontends/raft/loom/thread-adaptation.ts";
import { adaptComposerDirectory } from "../../frontends/raft/loom/composer-directory-adaptation.ts";
const base = "frontends/raft/upstream/raft-web-source/";
const path = "packages/web/src/components/message/";
function replace(s, a, b) {
  if (s.split(a).length !== 2) throw Error("Host boundary changed: " + a);
  return s.replace(a, b);
}
function imports(s, name) {
  const f = ts.createSourceFile(name, s, 99, true, 4),
    edits = [];
  const aliases = {
    "loom-attachment-comments": "./useAttachmentComments",
    "loom-message-profile": "./MessageProfile",
    "loom-appearance": "./AppearanceRuntime",
    "loom-channel-tasks": "./ChannelTasks",
    "loom-reactions": "./MessageReactions",
    "loom-thread-toolbar": "./ThreadToolbar",
    "loom-composer-directory": "./ComposerDirectory",
    "loom-attachments": "./Attachments",
    "./ProfilePreviewCardContent": "./MessageProfile",
    "../../api/client": "./upstream-api",
    "./messageMarkdownSecurity":
      "@loom/raft-web-source/messageMarkdownSecurity",
    "./remarkMessageTokens": "@loom/raft-web-source/remarkMessageTokens",
    "./repairGeneratedMarkdown":
      "@loom/raft-web-source/repairGeneratedMarkdown",
    "./threadSearch": "./OfficialMarkdownSearch.generated",
    "./AttachmentMetaText": "./OfficialAttachmentMetaText.generated",
  };
  for (const n of f.statements) {
    if (!ts.isImportDeclaration(n)) continue;
    const spec = n.moduleSpecifier.text;
    const bound =
      aliases[spec] ??
      (spec === "../ui/AvatarSlot" && name.endsWith("MessageInput.tsx")
        ? "./MentionAvatar"
        : spec === "@botiverse/raft-ui"
          ? "raft-ui"
          : spec.startsWith(".")
            ? "../" + posix.normalize(posix.join(posix.dirname(name), spec))
            : spec);
    if (bound !== spec)
      edits.push([
        n.moduleSpecifier.getStart(f),
        n.moduleSpecifier.end,
        JSON.stringify(bound),
      ]);
  }
  for (const [a, b, v] of edits.reverse()) s = s.slice(0, a) + v + s.slice(b);
  return s;
}
function composer(s) {
  s = adaptComposerDirectory(adaptTaskComposer(adaptComposerSubmit(s)));
  const f = ts.createSourceFile("input.tsx", s, 99, true, 4),
    nodes = [];
  function walk(n) {
    if (
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(f) === "Composer"
    )
      nodes.push(n);
    ts.forEachChild(n, walk);
  }
  walk(f);
  if (nodes.length !== 1) throw Error("Composer root changed");
  const view = readFileSync(
    "scripts/official-web/composer-host-slot.txt",
    "utf8",
  );
  s = s.slice(0, nodes[0].getStart(f)) + view + s.slice(nodes[0].end);
  return (
    'import OfficialComposerView from "./OfficialComposerView.generated";\nimport {ComposerFilesTools} from "./ComposerFiles";\n' +
    imports(s, path + "MessageInput.tsx")
  );
}
function message(s) {
  s = adaptMessageStatus(adaptMessageProfileNavigation(s));
  s = adaptMessageModelLabel(s);
  s = adaptReactions(adaptTaskMessage(adaptThreadItem(s)));
  // Preserve adopted accessible timestamp semantics while retaining native typography.
  s = replace(
    s,
    "<MessageItemTime render={<span />} className={`shrink-0 whitespace-nowrap ${messageMetaSizeClass} leading-4`}>{time}</MessageItemTime>",
    "<Tooltip content={gutterFullTimestamp}><MessageItemTime dateTime={new Date(message.createdAt).toISOString()} className={`shrink-0 whitespace-nowrap ${messageMetaSizeClass} leading-4`}>{time}</MessageItemTime></Tooltip>",
  );
  s = replace(
    s,
    "<MessageItemContinuationTime\n",
    "<MessageItemContinuationTime dateTime={new Date(message.createdAt).toISOString()}\n",
  );

  s =
    'import {boundMessageMentions} from "loom-message-profile";\nimport LoomAttachments from "loom-attachments";\n' +
    replace(
      s,
      "const effectiveMentionMap = readOnlyProjection\n    ? structuredMentionMap\n    : isExternal ? EXTERNAL_MESSAGE_MENTION_MAP : mentionMap;",
      "const boundMentionMap = useMemo(() => boundMessageMentions(mentionMap, message.mentions), [mentionMap, message.mentions]);\n  const effectiveMentionMap = isExternal ? EXTERNAL_MESSAGE_MENTION_MAP : readOnlyProjection ? boundMentionMap : mentionMap;",
    );
  s = replace(
    s,
    "<ReadOnlyMessageAttachments attachments={message.attachments} />",
    "<LoomAttachments attachments={message.attachments} parentMessage={message} />",
  );
  // Official public pages suppress profiles. Loom supplies authenticated member callbacks.
  s = s.replaceAll(
    "mentionsDisplayOnly={readOnlyProjection}",
    "mentionsDisplayOnly={readOnlyProjection && !onOpenProfile}",
  );
  s = replace(
    s,
    "useThreadStore((s) => isThreadFollowed(s, message.id))",
    "useThreadStore((s) => s.followedThreads.some((thread) => thread.parentMessageId === message.id))",
  );
  s = replace(
    s,
    "displayName: mention.displayName?.trim() || name,",
    "displayName: name,",
  );
  const f = ts.createSourceFile("item.tsx", s, 99, true, 4),
    edits = [];
  const removed = new Set([
    "InlineVideoAttachmentCard",
    "InlineAudioPlayer",
    "InlineAudioAttachmentCard",
    "formatAudioTimestamp",
    "useRenderMessageMarkdown",
    "ThreadSearchFragmentHighlight",
    "highlightThreadSearchInlineCode",
    "getRaftRefProp",
    "renderDisplayOnlyMention",
    "buildMentionIdentityMap",
    "mentionIdentityMapCache",
  ]);
  for (const n of f.statements) {
    let name = n.name?.text;
    if (
      ts.isVariableStatement(n) &&
      n.declarationList.declarations.length === 1
    )
      name = n.declarationList.declarations[0].name.getText(f);
    if (removed.has(name)) edits.push([n.getFullStart(), n.end, ""]);
  }
  function walk(n) {
    if (
      ts.isJsxSelfClosingElement(n) &&
      ["InlineVideoAttachmentCard", "InlineAudioAttachmentCard"].includes(
        n.tagName.getText(f),
      )
    ) {
      edits.push([n.getStart(f), n.end, "<></>"]);
      return;
    }
    if (
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(f) === "ProfilePreviewCardContent"
    )
      for (const a of n.attributes.properties)
        if (
          ts.isJsxAttribute(a) &&
          [
            "fallbackAgent",
            "fallbackMember",
            "readOnlyProfile",
            "onOpenAgentActivity",
          ].includes(a.name.getText(f))
        )
          edits.push([a.getStart(f), a.end, ""]);
    ts.forEachChild(n, walk);
  }
  for (const n of f.statements) if (!removed.has(n.name?.text)) walk(n);
  for (const [a, b, v] of edits.sort((a, b) => b[0] - a[0]))
    s = s.slice(0, a) + v + s.slice(b);
  // Prune imports for omitted provider media paths and extracted markdown declarations.
  const ast = ts.createSourceFile("item.tsx", s, 99, true, 4),
    ids = new Set(),
    importsEdits = [];
  function identifiers(n) {
    if (ts.isIdentifier(n)) ids.add(n.text);
    ts.forEachChild(n, identifiers);
  }
  for (const n of ast.statements)
    if (!ts.isImportDeclaration(n)) identifiers(n);
  for (const n of ast.statements) {
    if (!ts.isImportDeclaration(n) || !n.importClause) continue;
    const c = n.importClause,
      parts = [];
    if (c.name && ids.has(c.name.text)) parts.push(c.name.text);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
      const entries = c.namedBindings.elements.filter((e) =>
        ids.has(e.name.text),
      );
      if (entries.length)
        parts.push("{" + entries.map((e) => e.getText(ast)).join(",") + "}");
    }
    importsEdits.push([
      n.getStart(ast),
      n.end,
      parts.length
        ? "import " +
          (c.isTypeOnly ? "type " : "") +
          parts.join(",") +
          " from " +
          n.moduleSpecifier.getText(ast) +
          ";"
        : "",
    ]);
  }
  for (const [a, b, v] of importsEdits.reverse())
    s = s.slice(0, a) + v + s.slice(b);
  return (
    'import useRenderMessageMarkdown from "./OfficialMessageMarkdown.generated";\n' +
    imports(s, path + "MessageItem.tsx")
  );
}
export function generateChatHosts() {
  return {
    "OfficialAttachmentCommentsPanel.generated.tsx":
      "// GENERATED from Raft db5e399; Loom comment data/authority bindings.\n" +
      imports(
        adaptAttachmentComments(
          readFileSync(base + path + "AttachmentCommentsPanel.tsx", "utf8"),
        ),
        path + "AttachmentCommentsPanel.tsx",
      ),
    "OfficialAttachmentPreviewSurfaces.generated.tsx":
      "// GENERATED from Raft db5e399; whole-document PDF comment compatibility binding.\n" +
      imports(
        adaptPdfComments(
          readFileSync(base + path + "attachmentPreviewSurfaces.tsx", "utf8"),
        ),
        path + "attachmentPreviewSurfaces.tsx",
      ),
    "OfficialMessageInput.generated.tsx":
      "// GENERATED from Raft db5e399; explicit Loom file/send/directory bindings.\n" +
      composer(readFileSync(base + path + "MessageInput.tsx", "utf8")),
    "OfficialMessageItem.generated.tsx":
      "// GENERATED from Raft db5e399; explicit Loom identity/permission/action bindings.\n" +
      message(readFileSync(base + path + "MessageItem.tsx", "utf8")),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateChatHosts()))
    writeFileSync("frontends/raft/loom/" + name, source);
