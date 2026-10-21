import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclarations } from "./generate-appearance.mjs";
import { adaptTimelineWindow } from "./timeline-window-binding.ts";
import { adaptThreadFooter } from "./thread-panel-binding.ts";
const root =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/message/";
const banner =
  "// GENERATED from immutable Raft db5e399. Explicit Loom snapshot/window bindings; do not edit.\n";
export function generateChatHistory() {
  const timeline = adaptTimelineWindow(
    readFileSync(root + "MessageTimeline.tsx", "utf8"),
  ).replace(
    '"../../store/messageStore"',
    '"../packages/web/src/store/messageStore"',
  );
  const source = adaptThreadFooter(
    readFileSync(root + "ThreadPanel.tsx", "utf8"),
  );
  const ast = ts.createSourceFile(
    "thread.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const interfaces = ["ReadOnlyThreadData", "ThreadPanelProps"]
    .map((name) => {
      const nodes = ast.statements.filter(
        (n) => ts.isInterfaceDeclaration(n) && n.name.text === name,
      );
      if (nodes.length !== 1)
        throw Error("Official thread interface changed: " + name);
      return nodes[0].getText(ast);
    })
    .join("\n");
  const names = [
    "READ_ONLY_THREAD_PANEL_CLASS_NAME",
    "READ_ONLY_THREAD_BODY_CLASS_NAME",
    "THREAD_PANEL_PARENT_CLASS_NAME",
    "THREAD_CHROME_LAYER_CLASS_NAME",
    "THREAD_HEADER_CONTAINER_CLASS_NAME",
    "THREAD_HEADER_SUBTITLE_CLASS_NAME",
    "READ_ONLY_THREAD_HEADER_CONTAINER_PROPS",
    "THREAD_MOBILE_BACK_PROPS",
    "ReadOnlyThreadPanel",
  ];
  const header = `import {useMemo,useCallback,type ReactNode} from "react";
import {useIntl} from "react-intl";
import {X} from "lucide-react";
import {PanelAction,PanelMeta,PanelTitle,ThreadIcon,ThreadPanelBody,ThreadPanelContent,ThreadPanelRoot} from "raft-ui";
import type {Message} from "../packages/web/src/store/messageStore";
import type {Channel} from "../packages/web/src/store/channelStore";
import MessageItem,{type ReadOnlySenderProjection} from "../packages/web/src/components/message/MessageItem";
import MessageTimeline,{type MessageTimelineSource} from "./OfficialMessageTimeline.generated";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader";
import Tooltip from "@loom/raft-web-source/Tooltip";
import Banner from "@loom/raft-web-source/Banner";
import EmptyState from "@loom/raft-web-source/EmptyState";
import {useMessageMentionMap} from "./MessageProfile";
`;
  return {
    "OfficialMessageTimeline.generated.tsx": banner + timeline,
    "OfficialThreadPanel.generated.tsx":
      banner +
      header +
      interfaces +
      "\n" +
      extractDeclarations(source, names).join("\n\n") +
      "\nexport default ReadOnlyThreadPanel;\n",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateChatHistory()))
    writeFileSync("frontends/raft/loom/" + name, source);
