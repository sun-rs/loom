import { useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
import {
  WORKSPACE_MARKDOWN_COMPONENTS,
  WORKSPACE_MARKDOWN_REMARK_PLUGINS,
} from "./WorkspaceNativeParts.tsx";
const components = {
  ...WORKSPACE_MARKDOWN_COMPONENTS,
  img: ({ alt }: { alt?: string }) => (
    <span className="text-foreground-muted">
      {alt || "图片引用（请从文件树打开）"}
    </span>
  ),
};
/** Native AgentWorkspace preview/raw switch and renderer; bounded, no remote images. */
export default function WorkspaceFileContent({
  text,
  markdown,
}: {
  text: string;
  markdown: boolean;
}) {
  const [mode, setMode] = useState("preview");
  const lines = text.split(/\r?\n/);
  let body = lines.slice(0, 4000).join("\n");
  const truncated =
    lines.length > 4000 ||
    (markdown && mode === "preview" && body.length > 65536);
  if (markdown && mode === "preview") body = body.slice(0, 65536);
  return (
    <>
      {markdown && (
        <SegmentedControl
          value={mode}
          onValueChange={setMode}
          aria-label="文件视图"
          className="mb-3"
        >
          <SegmentedControlItem
            value="raw"
            data-testid="workspace-file-view-raw"
          >
            <SegmentedControlLabel>原文</SegmentedControlLabel>
          </SegmentedControlItem>
          <SegmentedControlItem
            value="preview"
            data-testid="workspace-file-view-preview"
          >
            <SegmentedControlLabel>预览</SegmentedControlLabel>
          </SegmentedControlItem>
        </SegmentedControl>
      )}
      {truncated && (
        <p role="status" className="mb-2 text-xs text-foreground-muted">
          内容较长，仅显示预览范围。
        </p>
      )}
      {markdown && mode === "preview" ? (
        <div className="text-sm text-foreground-strong theme-brutal:text-black break-words">
          <ReactMarkdown
            remarkPlugins={WORKSPACE_MARKDOWN_REMARK_PLUGINS}
            components={components}
          >
            {body}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words text-sm font-mono text-foreground-strong theme-brutal:text-black">
          {body}
        </pre>
      )}
    </>
  );
}
