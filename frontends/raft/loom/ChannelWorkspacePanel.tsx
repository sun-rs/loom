import {
  WorkspaceTreeHeader,
  TREE_ROW_CLASS,
} from "./OfficialWorkspace.generated";
import WorkspaceDocument from "./WorkspaceDocument.tsx";
import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  AgentWorkspaceRoot,
  ChannelWorkspaceReadResponse,
} from "@rah-os/protocol";
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
import { ArrowLeft } from "lucide-react";
import { SelectField } from "./ManagementUi.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import WorkspaceFileTree from "./WorkspaceFileTree.tsx";
import WorkspaceFileContent from "./WorkspaceFileContent.tsx";
type Source = {
  client: RahClient;
  roomId: string;
  rootId: AgentWorkspaceRoot["rootId"];
  hidden: boolean;
};
type Selection = { path: string; diff: boolean };
/** AgentWorkspace native layout/widths/compact navigation, with Channel reads. */
export default function ChannelWorkspacePanel({
  client,
  roomId,
}: {
  client: RahClient;
  roomId: string;
}) {
  const [roots, setRoots] = useState<AgentWorkspaceRoot[]>([]),
    [rootId, setRoot] =
      useState<AgentWorkspaceRoot["rootId"]>("runtime-project"),
    [error, setError] = useState("");
  const [hidden, setHidden] = useState(false),
    [mode, setMode] = useState("files"),
    [selection, setSelection] = useState<Selection>(),
    [version, setVersion] = useState(0);
  const resize = useResizablePanel({
    storageKey: "loom:channelWorkspaceTreeWidth",
    min: 160,
    max: 600,
    defaultWidth: 256,
  });
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    void client
      .request(
        "channel.workspace.read",
        {
          roomId,
          operation: "roots",
          rootId: "runtime-project",
          path: "",
          includeHidden: false,
        },
        { signal: abort.signal },
      )
      .then((r) => {
        if (!abort.signal.aborted && r.kind === "roots") {
          setRoots(r.value.roots);
          setRoot((old) =>
            r.value.roots.some((x) => x.rootId === old)
              ? old
              : r.value.defaultRootId,
          );
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [client, roomId, version]);
  const source = { client, roomId, rootId, hidden };
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-layer-canvas-muted "
      data-testid="channel-workspace"
    >
      <div className="flex items-center gap-2 border-b border-line-muted  bg-layer-panel  px-3 py-1.5">
        <div className="min-w-0 flex-1">
          {roots.length > 1 ? (
            <SelectField
              label="工作区目录"
              value={rootId}
              options={roots.map((r) => ({ value: r.rootId, label: r.label }))}
              onChange={(value) => {
                setRoot(value as typeof rootId);
                setSelection(undefined);
              }}
            />
          ) : (
            <span className="block truncate text-xs font-mono text-foreground-muted ">
              {roots[0]?.rootPath ?? "频道工作区"}
            </span>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="p-3 text-sm text-danger">
          {error}
        </p>
      ) : roots.length === 0 ? (
        <p role="status" className="p-3 text-sm">
          加载中…
        </p>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          <div
            className={`${selection ? "hidden md:flex" : "flex"} relative min-w-full md:min-w-0 shrink-0 flex-col border-r  border-line-muted  bg-layer-panel `}
            style={{ width: resize.width }}
          >
            <div
              data-testid="workspace-resize"
              className="hidden md:block absolute right-0 top-0 bottom-0 w-2 -mr-1 z-10 cursor-col-resize touch-none select-none"
              onPointerDown={resize.handleResizeStart}
              onPointerMove={resize.handleResizeMove}
              onPointerUp={resize.handleResizeEnd}
              onPointerCancel={resize.handleResizeEnd}
            />
            <WorkspaceTreeHeader
              showHiddenFiles={hidden}
              handleToggleHiddenFiles={(value) => {
                setHidden(value);
                setSelection(undefined);
              }}
              handleRefresh={() => {
                setSelection(undefined);
                setVersion((v) => v + 1);
              }}
              viewSelector={
                <SegmentedControl
                  value={mode}
                  onValueChange={(v) => {
                    setMode(v);
                    setSelection(undefined);
                  }}
                  aria-label="工作区视图"
                >
                  <SegmentedControlItem value="files">
                    <SegmentedControlLabel>文件</SegmentedControlLabel>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="changes">
                    <SegmentedControlLabel>Git 变更</SegmentedControlLabel>
                  </SegmentedControlItem>
                </SegmentedControl>
              }
            />
            <div
              className="flex-1 overflow-y-auto py-1"
              key={`${rootId}:${version}:${hidden}:${mode}`}
            >
              {mode === "changes" ? (
                <WorkspaceChanges
                  source={source}
                  selectedPath={selection?.path}
                  onSelect={setSelection}
                />
              ) : (
                <WorkspaceFileTree
                  {...source}
                  selectedPath={selection?.path ?? null}
                  onSelect={(path) => setSelection({ path, diff: false })}
                />
              )}
            </div>
          </div>
          <div
            className={`${selection ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col`}
          >
            {selection ? (
              <>
                <div className="flex items-center gap-2 border-b border-line-muted  bg-layer-panel  px-4 py-2">
                  <button
                    type="button"
                    className="md:hidden shrink-0 text-foreground-muted  hover:text-foreground-strong  transition-colors"
                    aria-label="返回文件列表"
                    onClick={() => setSelection(undefined)}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <span className="min-w-0 flex-1 font-mono text-sm font-medium text-foreground-strong  truncate">
                    {selection.path}
                  </span>
                </div>
                <WorkspacePreview
                  key={`${rootId}:${selection.path}:${selection.diff}:${version}`}
                  source={source}
                  selection={selection}
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-foreground-placeholder  font-mono text-sm">
                选择文件或 Git 变更
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function useRead(
  source: Source,
  operation: "list" | "read" | "changes" | "diff",
  path: string,
) {
  const [value, setValue] = useState<ChannelWorkspaceReadResponse>(),
    [error, setError] = useState("");
  const { client, roomId, rootId, hidden } = source;
  useEffect(() => {
    const abort = new AbortController();
    setValue(undefined);
    setError("");
    void client
      .request(
        "channel.workspace.read",
        { roomId, rootId, path, operation, includeHidden: hidden },
        { signal: abort.signal },
      )
      .then((r) => {
        if (!abort.signal.aborted) setValue(r);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [client, roomId, rootId, path, operation, hidden]);
  return { value, error };
}
function ReadState({ error }: { error: string }) {
  return (
    <p
      role={error ? "alert" : "status"}
      className="p-2 text-sm text-foreground-muted"
    >
      {error || "加载中…"}
    </p>
  );
}
function WorkspaceChanges({
  selectedPath,
  source,
  onSelect,
}: {
  source: Source;
  onSelect: (s: Selection) => void;
  selectedPath: string | undefined;
}) {
  const { value, error } = useRead(source, "changes", "");
  if (error || !value) return <ReadState error={error} />;
  if (value.kind !== "changes") return null;
  return (
    <>
      {!value.entries.length && (
        <p className="px-3 py-4 text-center text-sm text-foreground-muted">
          没有可展示的变更
        </p>
      )}
      {value.entries.map((e) => (
        <button
          key={e.path}
          type="button"
          className={`${TREE_ROW_CLASS} pl-2 ${selectedPath === e.path ? "bg-info-soft" : "hover:bg-fill-pressed"}`}
          aria-label={`查看差异 ${e.path}`}
          onClick={() => onSelect({ path: e.path, diff: true })}
        >
          <span className="font-mono text-xs">{e.status}</span>
          <span className="truncate">{e.path}</span>
        </button>
      ))}
      {value.truncated && <p className="px-3 text-xs">仅显示前 500 个变更。</p>}
    </>
  );
}
function WorkspacePreview({
  source,
  selection,
}: {
  source: Source;
  selection: Selection;
}) {
  const { value, error } = useRead(
    source,
    selection.diff ? "diff" : "read",
    selection.path,
  );
  return (
    <div
      data-testid="workspace-preview"
      className="min-h-0 min-w-0 flex-1 overflow-auto p-4"
    >
      {error || !value ? (
        <ReadState error={error} />
      ) : value.kind === "diff" ? (
        <WorkspaceFileContent
          text={value.text || "此文件无文本差异"}
          markdown={false}
        />
      ) : value.kind === "read" ? (
        (value.value.mimeType === "application/pdf" ||
          /\.html?$/i.test(selection.path)) &&
        value.value.content !== null ? (
          <WorkspaceDocument
            file={value.value}
            request={{
              roomId: source.roomId,
              rootId: source.rootId,
              path: selection.path,
              operation: "read",
              includeHidden: source.hidden,
            }}
          />
        ) : value.value.encoding === "utf-8" ? (
          <WorkspaceFileContent
            text={value.value.content ?? ""}
            markdown={selection.path.endsWith(".md")}
          />
        ) : value.value.encoding === "base64" ? (
          <img
            className="max-h-full max-w-full border  border-line-muted  object-contain"
            alt={selection.path}
            src={`data:${value.value.mimeType};base64,${value.value.content}`}
          />
        ) : (
          <p className="text-sm">
            该文件为二进制或超出预览上限，暂不支持内联预览。
          </p>
        )
      ) : null}
    </div>
  );
}
