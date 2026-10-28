import ts from "typescript";
import { generateRefresh135 } from "./generate-refresh135.mjs";
import { extractDeclarations } from "./generate-appearance.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const base =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/";
const header =
  "// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.\n";
function parse(path) {
  const source = readFileSync(base + path + ".tsx", "utf8");
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (file.parseDiagnostics.length) throw Error("Invalid official source");
  return { source, file };
}
function replaceOnce(s, from, to) {
  if (s.split(from).length !== 2)
    throw Error("Official boundary changed: " + from);
  return s.replace(from, to);
}
function module(path) {
  const { file } = parse(path);
  return (
    header +
    file.statements
      .map((n) => {
        let s = n.getText(file);
        if (ts.isImportDeclaration(n)) {
          const spec = n.moduleSpecifier.text;
          if (spec === "@botiverse/raft-ui") return s.replace(spec, "raft-ui");
          if (spec.startsWith(".")) {
            const target = posix.normalize(
              posix.join(posix.dirname(path), spec),
            );
            const mapped =
              path === "task/TaskModalHead" && spec === "./TaskProperties"
                ? "./TaskProperties.tsx"
                : target === "ui/ShowMoreToggle"
                  ? "@loom/raft-web-source/ShowMoreToggle"
                  : "../packages/web/src/" +
                    posix.normalize("components/" + target);
            return s.replace(spec, mapped);
          }
        }
        return s;
      })
      .join("\n") +
    "\n"
  );
}
export function generateDiscoveryTask() {
  let entity = module("search/EntityResultRow");
  // Local menu close returns focus to the row; official root has no ref slot.
  entity = replaceOnce(
    entity,
    "  result,\n  returnHint,",
    "  result,\n  rootRef,\n  returnHint,",
  );
  entity = replaceOnce(
    entity,
    "  result: SearchEntityRecord;",
    '  result: SearchEntityRecord;\n  rootRef?: import("react").Ref<HTMLDivElement>;',
  );
  entity = replaceOnce(
    entity,
    "    <div\n      data-testid=",
    "    <div\n      ref={rootRef}\n      data-entity-id={result.key}\n      data-testid=",
  );
  const { file } = parse("thread/ThreadsInbox");
  let empty;
  function walk(n) {
    if (
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(file) === "EmptyState" &&
      n.getText(file).includes("thread.empty.mentionsTitle")
    ) {
      if (empty) throw Error("Ambiguous empty state");
      empty = n.getText(file);
    }
    ts.forEachChild(n, walk);
  }
  walk(file);
  if (!empty) throw Error("Missing empty state");
  // Loom supports mentions/unread/all, not upstream's other feed read filters.
  empty = replaceOnce(
    empty,
    'activityReadFilter(filter) === "unread"',
    'filter === "unread"',
  );
  // Official 1.21.34 pinned empty state, Chinese resource zh-cn-DEd8tY9e.js.
  empty = replaceOnce(
    empty,
    'title={filter === "mentions"',
    'title={filter === "pinned" ? "没有置顶的会话" : filter === "mentions"',
  );
  empty = replaceOnce(
    empty,
    'description={filter === "mentions"',
    'description={filter === "pinned" ? "在侧栏置顶的频道和私信会显示在这里，连同它们的消息列。" : filter === "mentions"',
  );
  let hit = module("search/MessageHitRow");
  hit = replaceOnce(
    hit,
    "  result,\n  nested,",
    "  result,\n  resultKey,\n  nested,",
  );
  hit = replaceOnce(
    hit,
    "  result: MessageSearchResult;",
    "  result: MessageSearchResult;\n  resultKey?: string;",
  );
  hit = replaceOnce(
    hit,
    '    <Result\n      type="button"',
    '    <Result\n      data-result-id={resultKey}\n      type="button"',
  );
  const avatar = extractDeclarations(parse("thread/ThreadsInbox").source, [
    "ConversationAvatar",
  ]);
  return {
    "OfficialMessageHitRow.generated.tsx": hit,
    "OfficialConversationAvatar.generated.tsx":
      header +
      'import {IconTile, DirectMessageIcon, ThreadIcon} from "raft-ui";\nimport {Hash} from "lucide-react";\nimport AvatarSlot from "../packages/web/src/components/ui/AvatarSlot";\ntype Channel = {peerType: "agent" | "user"; peerAvatarUrl?: string | null; peerGravatarHash?: string | null};\n' +
      avatar +
      "\nexport default ConversationAvatar;\n",
    "OfficialActivityFilters.generated.tsx":
      generateRefresh135()["OfficialActivityFilters.generated.tsx"],
    "OfficialTaskModalHead.generated.tsx": module("task/TaskModalHead"),
    "OfficialSearchEntityRow.generated.tsx": entity,
    "OfficialSearchHomeRow.generated.tsx": module("search/SearchHomeEntityRow"),
    "OfficialActivityEmpty.generated.tsx":
      header +
      'import {useIntl} from "react-intl";\nimport {MessageSquareText} from "lucide-react";\nimport EmptyState from "@loom/raft-web-source/EmptyState";\nexport default function ActivityEmpty({filter}:{filter?:string}) {const {formatMessage}=useIntl();return (' +
      empty +
      ");}\n",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, content] of Object.entries(generateDiscoveryTask()))
    writeFileSync("frontends/raft/loom/" + name, content);
