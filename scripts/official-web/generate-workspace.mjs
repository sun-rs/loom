import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const base =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/";
function declaration(source, name) {
  const ast = ts.createSourceFile("source.tsx", source, 99, true, 4);
  const matches = ast.statements.filter(
    (n) =>
      (n.name?.text ??
        (ts.isVariableStatement(n)
          ? n.declarationList.declarations[0].name.getText(ast)
          : "")) === name,
  );
  if (matches.length !== 1) throw Error("Workspace declaration drift: " + name);
  return matches[0].getText(ast);
}
function jsx(source, predicate) {
  const ast = ts.createSourceFile("source.tsx", source, 99, true, 4),
    matches = [];
  function walk(n) {
    if (ts.isJsxElement(n) && predicate(n, ast)) matches.push(n);
    ts.forEachChild(n, walk);
  }
  walk(ast);
  if (matches.length !== 1)
    throw Error("Workspace JSX boundary drift: " + matches.length);
  return matches[0].getText(ast);
}
export function generateWorkspace() {
  const source = readFileSync(base + "agent/AgentWorkspace.tsx", "utf8");
  const item = readFileSync(base + "message/MessageItem.tsx", "utf8");
  const names = [
    "DirTruncation",
    "TruncationHint",
    "WORKSPACE_MARKDOWN_REMARK_PLUGINS",
    "WORKSPACE_MARKDOWN_COMPONENTS",
    "TREE_ROW_CLASS",
    "TREE_ICON_BUTTON_CLASS",
    "TreeNode",
  ];
  let declarations = names
    .map(
      (name) =>
        ([
          "DirTruncation",
          "WORKSPACE_MARKDOWN_REMARK_PLUGINS",
          "WORKSPACE_MARKDOWN_COMPONENTS",
          "TREE_ROW_CLASS",
          "TreeNode",
        ].includes(name)
          ? "export "
          : "") + declaration(source, name),
    )
    .join("\n\n");
  // Preserve existing keyboard/screen-reader identity without changing source recipes.
  declarations = declarations
    .replace(
      "onClick={() => onToggleDir(node.path)}",
      'aria-label={`${isExpanded ? "收起" : "展开"} ${node.name}`} aria-expanded={isExpanded}\n          onClick={() => onToggleDir(node.path)}',
    )
    .replace(
      "onClick={() => onSelectFile(node.path)}",
      "aria-label={`打开 ${node.name}`}\n      onClick={() => onSelectFile(node.path)}",
    );
  const toggle = jsx(
    source,
    (n) => n.openingElement.tagName.getText() === "SegmentedControl",
  );
  const preview = jsx(
    source,
    (n, a) =>
      n.openingElement.tagName.getText(a) === "div" &&
      n.openingElement
        .getText(a)
        .includes("break-words text-callout text-foreground"),
  );
  const treeHeader = jsx(
    source,
    (n, a) =>
      n.openingElement.tagName.getText(a) === "div" &&
      n.openingElement
        .getText(a)
        .includes("justify-between border-b border-line-seam py-1.5"),
  ).replace(/<SectionEyebrow>[\s\S]*?<\/SectionEyebrow>/, "{viewSelector}");
  const raw = jsx(
    source,
    (n, a) => n.openingElement.tagName.getText(a) === "pre",
  );
  const workspace = `// GENERATED from immutable Raft db5e399 AgentWorkspace and MessageItem declarations.
// Loom owns rooted reads, cancellation, bounded rendering and external-image suppression.
import {InlineCode,Spinner,SegmentedControl,SegmentedControlItem,SegmentedControlLabel} from "raft-ui";
import type {ReactNode} from "react";
import Tooltip from "@loom/raft-web-source/Tooltip";
import {ChevronRight,FolderClosed,FolderOpen,FileText,Eye,EyeOff,RefreshCw} from "lucide-react";
import {useIntl} from "react-intl";
import ReactMarkdown from "react-markdown";
import type {Components,Options} from "react-markdown";
import remarkGfm from "remark-gfm";
import type {FileNode} from "@botiverse/raft-shared";
import CodeBlock from "./OfficialCodeBlock.generated";
import {MARKDOWN_BLOCKQUOTE_BASE_CLASS} from "./OfficialMarkdownContent.generated";
import {transparentImageBackgroundClass} from "../packages/web/src/utils/imagePreviewStyles";
${declarations}

export function WorkspaceTreeHeader({viewSelector,showHiddenFiles,handleToggleHiddenFiles,handleRefresh}:{viewSelector:ReactNode;showHiddenFiles:boolean;handleToggleHiddenFiles:(value:boolean)=>void;handleRefresh:()=>void}){const {formatMessage}=useIntl();return (${treeHeader});}
export function WorkspaceViewToggle({viewMode,setViewMode}:{viewMode:string;setViewMode:(value:string)=>void}){const {formatMessage}=useIntl();return (${toggle});}
export function WorkspaceTextView({text,preview,components}:{text:string;preview:boolean;components:Components}) {
 const fileContent={content:text};
 const WORKSPACE_MARKDOWN_COMPONENTS=components;
 return preview ? (${preview}) : (${raw});
}
`;
  return {
    "OfficialWorkspace.generated.tsx": workspace,
    "OfficialDiffStats.generated.tsx": `// GENERATED from immutable Raft db5e399 MessageItem declaration; import-only binding.
import {useIntl} from "react-intl";
import {MessageAttachmentDiffSummary,MessageAttachmentDiffAddition,MessageAttachmentDiffDeletion} from "raft-ui";
import type {DiffAttachmentPreview} from "../packages/web/src/components/message/attachmentPreview";
export ${declaration(item, "DiffPatchStatsLine")}
`,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateWorkspace()))
    writeFileSync("frontends/raft/loom/" + name, source);
