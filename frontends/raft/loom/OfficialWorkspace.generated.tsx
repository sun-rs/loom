// GENERATED from immutable Raft db5e399 AgentWorkspace and MessageItem declarations.
// Loom owns rooted reads, cancellation, bounded rendering and external-image suppression.
import {InlineCode,Separator,Spinner,SegmentedControl,SegmentedControlItem,SegmentedControlLabel} from "raft-ui";
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
export interface DirTruncation {
  shown: number;
  omitted: number | null;
}

function TruncationHint({ truncation, indent }: { truncation: DirTruncation; indent: number }) {
  const { formatMessage } = useIntl();
  return (
    <div
      className="py-1 pr-2 text-caption text-foreground-hint"
      style={{ paddingLeft: `${indent}px` }}
      data-testid="agent-workspace-truncated"
    >
      {truncation.omitted !== null
        ? formatMessage({ id: "agent.workspace.truncated" }, { shown: truncation.shown, omitted: truncation.omitted })
        : formatMessage({ id: "agent.workspace.truncatedUnknown" }, { shown: truncation.shown })}
    </div>
  );
}

export const WORKSPACE_MARKDOWN_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkGfm];

export const WORKSPACE_MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => (
    <CodeBlock className="overflow-x-auto rounded-container border border-line-hairline bg-layer-code px-3 py-2 pr-12 font-mono text-mono-code text-foreground [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </CodeBlock>
  ),
  code: ({ children, className }) => {
    if (!className) {
      return (
        <InlineCode appearance="message" className="bg-fill-muted text-foreground [overflow-wrap:break-word]">
          {children}
        </InlineCode>
      );
    }
    return <code className={className}>{children}</code>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground-link underline decoration-2 underline-offset-2 hover:decoration-attention"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children, className, ...props }) => (
    <ul
      {...props}
      className={[className, "mb-2 pl-5 list-disc"].filter(Boolean).join(" ")}
    >
      {children}
    </ul>
  ),
  ol: ({ children, className, ...props }) => (
    <ol
      {...props}
      className={[className, "mb-2 pl-5 list-decimal"].filter(Boolean).join(" ")}
    >
      {children}
    </ol>
  ),
  li: ({ children, className, ...props }) => (
    <li
      {...props}
      className={[className, "mb-0.5"].filter(Boolean).join(" ")}
    >
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className={`${MARKDOWN_BLOCKQUOTE_BASE_CLASS} my-2`}>
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse border border-line-hairline text-callout">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line-hairline bg-fill-muted px-2 py-1 text-left font-bold whitespace-nowrap text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-line-hairline px-2 py-1">{children}</td>
  ),
  h1: ({ children }) => <h1 className="mt-4 mb-2 text-title font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-headline font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-body font-bold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-callout font-bold">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-1.5 mb-0.5 text-callout font-bold">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-1.5 mb-0.5 text-callout font-bold text-foreground-muted">{children}</h6>,
  hr: () => <Separator className="my-3" />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt || ""} className={`my-2 max-w-full rounded-container border border-line-hairline ${transparentImageBackgroundClass}`} />
  ),
};

export const TREE_ROW_CLASS ="flex w-full items-center gap-1 py-1 pr-2 text-left font-mono text-mono-code text-foreground transition-colors outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--foreground)]";

const TREE_ICON_BUTTON_CLASS = "flex size-8 shrink-0 items-center justify-center rounded-control transition-colors hover:bg-fill-pressed hover:text-foreground";

export function TreeNode({
  node,
  depth,
  selectedPath,
  expandedDirs,
  loadingDirs,
  loadingLabel,
  getChildren,
  getTruncation,
  onSelectFile,
  onToggleDir,
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  loadingDirs: Set<string>;
  loadingLabel: string;
  getChildren: (dirPath: string) => FileNode[] | undefined;
  getTruncation: (dirPath: string) => DirTruncation | undefined;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;
  const isMemory = node.name === "memory.md";
  const isLoading = loadingDirs.has(node.path);
  const hiddenTextClass = node.isHidden ? "text-foreground-hint" : "";

  if (node.isDirectory) {
    const children = isExpanded ? getChildren(node.path) : undefined;
    const truncation = children ? getTruncation(node.path) : undefined;
    return (
      <div>
        <button
          type="button"
          aria-label={`${isExpanded ? "收起" : "展开"} ${node.name}`} aria-expanded={isExpanded}
          onClick={() => onToggleDir(node.path)}
          className={`${TREE_ROW_CLASS} ${isSelected ? "bg-info-soft" : "hover:bg-fill-pressed"}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-foreground-hint transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
          {isExpanded ? (
            <FolderOpen size={14} className="shrink-0 text-foreground-muted" />
          ) : (
            <FolderClosed size={14} className="shrink-0 text-foreground-muted" />
          )}
          <span className={`truncate font-medium ${hiddenTextClass}`}>{node.name}</span>
        </button>
        {isExpanded && (
          <div>
            {isLoading ? (
              <div
                className="flex items-center gap-1.5 py-1 text-caption text-foreground-hint"
                style={{ paddingLeft: `${(depth + 1) * 16 + 22}px` }}
              >
                <Spinner size="xs" aria-label={loadingLabel} />
                {loadingLabel}
              </div>
            ) : children ? (
              <>
                {children.map((child) => (
                  <TreeNode
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    selectedPath={selectedPath}
                    expandedDirs={expandedDirs}
                    loadingDirs={loadingDirs}
                    loadingLabel={loadingLabel}
                    getChildren={getChildren}
                    getTruncation={getTruncation}
                    onSelectFile={onSelectFile}
                    onToggleDir={onToggleDir}
                  />
                ))}
                {truncation && <TruncationHint truncation={truncation} indent={(depth + 1) * 16 + 22} />}
              </>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={`打开 ${node.name}`}
      onClick={() => onSelectFile(node.path)}
      className={`${TREE_ROW_CLASS} ${isSelected ? "bg-info-soft" : "hover:bg-fill-pressed"}`}
      style={{ paddingLeft: `${depth * 16 + 22}px` }}
    >
      <FileText size={14} className="shrink-0 text-foreground-muted" />
      <span className={`truncate ${isMemory ? "font-bold" : ""} ${hiddenTextClass}`}>
        {node.name}
      </span>
    </button>
  );
}

export function WorkspaceTreeHeader({viewSelector,showHiddenFiles,handleToggleHiddenFiles,handleRefresh}:{viewSelector:ReactNode;showHiddenFiles:boolean;handleToggleHiddenFiles:(value:boolean)=>void;handleRefresh:()=>void}){const {formatMessage}=useIntl();return (<div className="flex items-center justify-between border-b border-line-seam py-1.5 pr-1.5 pl-3">
          {viewSelector}
          <div className="flex items-center gap-1">
            <Tooltip content={showHiddenFiles
              ? formatMessage({ id: "agent.workspace.hiddenFilesShown" })
              : formatMessage({ id: "agent.workspace.hiddenFilesHidden" })}>
              <button
                type="button"
                onClick={() => handleToggleHiddenFiles(!showHiddenFiles)}
                className={`${TREE_ICON_BUTTON_CLASS} ${
                  showHiddenFiles ? "text-foreground" : "text-foreground-hint"
                }`}
                aria-label={showHiddenFiles
                  ? formatMessage({ id: "agent.workspace.hiddenFilesShown" })
                  : formatMessage({ id: "agent.workspace.hiddenFilesHidden" })}
                aria-pressed={showHiddenFiles}
              >
                {showHiddenFiles ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </Tooltip>
            <Tooltip content={formatMessage({ id: "agent.workspace.refresh" })}>
              <button
                type="button"
                onClick={handleRefresh}
                className={`${TREE_ICON_BUTTON_CLASS} text-foreground-muted`}
                aria-label={formatMessage({ id: "agent.workspace.refresh" })}
              >
                <RefreshCw size={16} />
              </button>
            </Tooltip>
          </div>
        </div>);}
export function WorkspaceViewToggle({viewMode,setViewMode}:{viewMode:string;setViewMode:(value:string)=>void}){const {formatMessage}=useIntl();return (<SegmentedControl
                  value={viewMode}
                  onValueChange={setViewMode}
                  aria-label={formatMessage({ id: "agent.workspace.viewMode" })}
                  className="ml-auto shrink-0"
                >
                  <SegmentedControlItem value="raw" data-testid="workspace-file-view-raw">
                    <SegmentedControlLabel>{formatMessage({ id: "agent.workspace.raw" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="preview" data-testid="workspace-file-view-preview">
                    <SegmentedControlLabel>{formatMessage({ id: "agent.workspace.preview" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                </SegmentedControl>);}
export function WorkspaceTextView({text,preview,components}:{text:string;preview:boolean;components:Components}) {
 const fileContent={content:text};
 const WORKSPACE_MARKDOWN_COMPONENTS=components;
 return preview ? (<div className="break-words text-callout text-foreground">
                  <ReactMarkdown
                    remarkPlugins={WORKSPACE_MARKDOWN_REMARK_PLUGINS}
                    components={WORKSPACE_MARKDOWN_COMPONENTS}
                  >
                    {fileContent.content || ""}
                  </ReactMarkdown>
                </div>) : (<pre className="whitespace-pre-wrap break-words font-mono text-mono-code text-foreground">
                  {fileContent.content || ""}
                </pre>);
}
