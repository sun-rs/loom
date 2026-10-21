import { uiActionProps } from "./ui-action-props.ts";
import { useState } from "react";
import { Button } from "raft-ui";
import {
  WORKSPACE_MARKDOWN_COMPONENTS,
  WorkspaceTextView,
  WorkspaceViewToggle,
} from "./OfficialWorkspace.generated";
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
  const [lineLimit, setLineLimit] = useState(4000);
  const lines = text.split(/\r?\n/);
  let body = lines.slice(0, lineLimit).join("\n");
  const truncated =
    lines.length > lineLimit ||
    (markdown && mode === "preview" && body.length > 65536);
  if (markdown && mode === "preview") body = body.slice(0, 65536);
  return (
    <>
      {markdown && (
        <WorkspaceViewToggle viewMode={mode} setViewMode={setMode} />
      )}
      {truncated && (
        <p role="status" className="mb-2 text-xs text-foreground-muted">
          内容较长，仅显示预览范围。
        </p>
      )}
      <WorkspaceTextView
        text={body}
        preview={markdown && mode === "preview"}
        components={components}
      />
      {lines.length > lineLimit && (!markdown || mode === "raw") && (
        <Button
          {...uiActionProps.secondary}
          onClick={() => setLineLimit((n) => n + 4000)}
        >
          显示更多
        </Button>
      )}
    </>
  );
}
