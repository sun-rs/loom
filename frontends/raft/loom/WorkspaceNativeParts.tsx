// SPDX-License-Identifier: FSL-1.1-ALv2
// https://github.com/botiverse/raft-source @ a98ae003246a0360872a77d76dec2fccd0347ef7
// Upstream notice/license retained at frontends/raft/LICENSE.
// Structural extraction from official AgentWorkspace.tsx; provenance in channel-workspace evidence.
import { InlineCode, Spinner } from "raft-ui";
import { ChevronRight, FolderClosed, FolderOpen, FileText } from "lucide-react";
import { useIntl } from "react-intl";
import type { Components, Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FileNode } from "@botiverse/raft-shared";
import CodeBlock from "../packages/web/src/components/markdown/CodeBlock.tsx";
import { MARKDOWN_BLOCKQUOTE_BASE_CLASS } from "../packages/web/src/components/markdown/MarkdownContent.tsx";
import { transparentImageBackgroundClass } from "../packages/web/src/utils/imagePreviewStyles.ts";
export interface DirTruncation {
  shown: number;
  omitted: number | null;
}

function TruncationHint({
  truncation,
  indent,
}: {
  truncation: DirTruncation;
  indent: number;
}) {
  const { formatMessage } = useIntl();
  return (
    <div
      className="py-1 pr-2 text-xs text-foreground-placeholder  font-mono"
      style={{ paddingLeft: `${indent}px` }}
      data-testid="agent-workspace-truncated"
    >
      {truncation.omitted !== null
        ? formatMessage(
            { id: "agent.workspace.truncated" },
            { shown: truncation.shown, omitted: truncation.omitted },
          )
        : formatMessage(
            { id: "agent.workspace.truncatedUnknown" },
            { shown: truncation.shown },
          )}
    </div>
  );
}

// Stable plugin list / component map for the workspace markdown preview —
// passing fresh literals would re-mount ReactMarkdown's AST on every render.
export const WORKSPACE_MARKDOWN_REMARK_PLUGINS: NonNullable<
  Options["remarkPlugins"]
> = [remarkGfm];
export const WORKSPACE_MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => (
    <CodeBlock className="overflow-x-auto border  border-line-muted  bg-code-surface rounded-md  p-3 pr-12 text-sm text-code-foreground font-mono [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </CodeBlock>
  ),
  code: ({ children, className }) => {
    if (!className) {
      return (
        <InlineCode className="rounded-none border-0 bg-fill-muted px-1 py-0 [font-size:0.875em] font-mono font-normal leading-[1.3em] text-foreground-strong [overflow-wrap:break-word]">
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
      className="text-blue-700 dark:text-blue-300 underline decoration-2 underline-offset-2 hover:text-accent-strong "
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
      className={[className, "mb-2 pl-5 list-decimal"]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </ol>
  ),
  li: ({ children, className, ...props }) => (
    <li {...props} className={[className, "mb-0.5"].filter(Boolean).join(" ")}>
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
      <table className="border-collapse border  border-line-muted  text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border  border-line-muted  bg-info-soft  px-2 py-1 text-left font-bold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-line-muted  px-2 py-1">{children}</td>
  ),
  h1: ({ children }) => (
    <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-bold mt-3 mb-1.5">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-bold mt-2 mb-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-bold mt-2 mb-1">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-bold mt-1.5 mb-0.5">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-bold mt-1.5 mb-0.5 text-foreground-muted ">
      {children}
    </h6>
  ),
  hr: () => <hr className="my-3 border-t  border-line-muted " />,
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || ""}
      className={`my-2 max-w-full border  border-line-muted  ${transparentImageBackgroundClass}`}
    />
  ),
};

// --- File tree node component ---

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
  const hiddenTextClass = node.isHidden ? "text-foreground-muted " : "";

  if (node.isDirectory) {
    const children = isExpanded ? getChildren(node.path) : undefined;
    const truncation = children ? getTruncation(node.path) : undefined;
    return (
      <div>
        <button
          type="button"
          aria-label={`${isExpanded ? "收起" : "展开"} ${node.name}`}
          aria-expanded={isExpanded}
          onClick={() => onToggleDir(node.path)}
          className={`flex w-full items-center gap-1 py-1 pr-2 text-sm text-left hover:bg-fill-muted  transition-colors ${
            isSelected ? "bg-accent-soft " : ""
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <ChevronRight
            size={14}
            className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
          {isExpanded ? (
            <FolderOpen size={14} className="shrink-0 text-warning-strong " />
          ) : (
            <FolderClosed size={14} className="shrink-0 text-warning-strong " />
          )}
          <span className={`truncate font-medium ${hiddenTextClass}`}>
            {node.name}
          </span>
        </button>
        {isExpanded && (
          <div>
            {isLoading ? (
              <div
                className="flex items-center gap-1.5 py-1 text-xs text-foreground-placeholder  font-mono"
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
                {truncation && (
                  <TruncationHint
                    truncation={truncation}
                    indent={(depth + 1) * 16 + 22}
                  />
                )}
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
      className={`flex w-full items-center gap-1 py-1 pr-2 text-sm text-left transition-colors ${
        isSelected
          ? "bg-accent-soft  border-r  border-line-strong "
          : "hover:bg-fill-muted "
      }`}
      style={{ paddingLeft: `${depth * 16 + 22}px` }}
    >
      <FileText size={14} className="shrink-0 text-foreground-muted " />
      <span
        className={`truncate ${isMemory ? "font-bold" : ""} ${hiddenTextClass}`}
      >
        {node.name}
      </span>
    </button>
  );
}
