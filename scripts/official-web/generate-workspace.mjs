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
function opening(source, marker) {
  const element = jsx(source, (n, a) =>
    n.openingElement.getText(a).includes(marker),
  );
  const ast = ts.createSourceFile("part.tsx", element, 99, true, 4);
  return ast.statements[0].expression.openingElement.getText(ast);
}
function workspaceShell(source) {
  const frame = opening(
    source,
    'className="flex min-h-0 flex-1 flex-col bg-layer-canvas"',
  );
  const pathBar = opening(
    source,
    'className="flex items-center gap-2 border-b border-line-seam bg-layer-canvas px-3 py-1.5"',
  );
  const split = opening(source, 'className="flex min-h-0 flex-1"');
  const tree = opening(source, "${selectedPath ? (compact ?");
  const detail = opening(source, "${!selectedPath ? (compact ?");
  let header = jsx(source, (n, a) =>
    n.openingElement
      .getText(a)
      .includes(
        'className="flex items-center gap-2 border-b border-line-seam bg-layer-canvas px-4 py-2"',
      ),
  );
  const ast = ts.createSourceFile("header.tsx", header, 99, true, 4);
  const edits = [];
  function walk(n) {
    if (
      ts.isJsxExpression(n) &&
      n.getText(ast).startsWith("{fileContent.path.endsWith")
    )
      edits.push([n.getStart(ast), n.end, "{actions}"]);
    ts.forEachChild(n, walk);
  }
  walk(ast);
  for (const [start, end, text] of edits.reverse())
    header = header.slice(0, start) + text + header.slice(end);
  header = header.replace(
    "onClick={() => { setSelectedPath(null); setFileContent(null); setFileError(null); }}",
    'aria-label="返回文件列表" onClick={onBack}',
  );
  const image = jsx(
    source,
    (n, a) =>
      n.openingElement.getText(a) ===
      '<div className="flex h-full min-h-0 items-center justify-center overflow-auto">',
  );
  const resize = source.match(
    /<div\s+className="hidden md:block absolute right-0 top-0 bottom-0 w-2 -mr-1 z-10 cursor-col-resize touch-none select-none"[\s\S]*?\/>/g,
  );
  if (resize?.length !== 1) throw Error("Workspace resize declaration drift");
  return `
export function WorkspaceImage({fileContent}:{fileContent:{path:string;mimeType:string;content:string|null}}){return (${image});}
export function WorkspaceFrame({children}:{children:ReactNode}){return (${frame.replace("<div ", '<div data-testid="channel-workspace" ')}{children}</div>);}
export function WorkspacePathBar({children}:{children:ReactNode}){return (${pathBar}{children}</div>);}
export function WorkspaceSplit({children}:{children:ReactNode}){return (${split}{children}</div>);}
export function WorkspaceTreePane({selectedPath,treeWidth,children}:{selectedPath?:string;treeWidth:number;children:ReactNode}){const compact=false;return (${tree}{children}</div>);}
export function WorkspaceDetailPane({selectedPath,children}:{selectedPath?:string;children:ReactNode}){const compact=false;return (${detail}{children}</div>);}
export function WorkspaceResizeHandle({handleResizeStart,handleResizeMove,handleResizeEnd}:{handleResizeStart:PointerEventHandler<HTMLDivElement>;handleResizeMove:PointerEventHandler<HTMLDivElement>;handleResizeEnd:PointerEventHandler<HTMLDivElement>}){return (${resize[0].replace("<div", '<div data-testid="workspace-resize"')});}
export function WorkspaceFileHeader({path,onBack,actions}:{path:string;onBack:()=>void;actions?:ReactNode}){const compact=false,fileContent={path};return (${header});}
`;
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
import {InlineCode,Separator,Spinner,SegmentedControl,SegmentedControlItem,SegmentedControlLabel} from "raft-ui";
import type {ReactNode,PointerEventHandler} from "react";
import Tooltip from "@loom/raft-web-source/Tooltip";
import {ArrowLeft,ChevronRight,FolderClosed,FolderOpen,FileText,Eye,EyeOff,RefreshCw} from "lucide-react";
import {useIntl} from "react-intl";
import ReactMarkdown from "react-markdown";
import type {Components,Options} from "react-markdown";
import remarkGfm from "remark-gfm";
import type {FileNode} from "@botiverse/raft-shared";
import CodeBlock from "./OfficialCodeBlock.generated";
import {MARKDOWN_BLOCKQUOTE_BASE_CLASS} from "./OfficialMarkdownContent.generated";
import {transparentImageBackgroundClass} from "../packages/web/src/utils/imagePreviewStyles";
${declarations}
${workspaceShell(source)}

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
