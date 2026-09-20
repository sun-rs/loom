import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  AgentWorkspaceFile,
  AgentWorkspaceListing,
  AgentWorkspaceRoot,
} from "@rah-os/protocol";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { FileGlyph } from "./file-glyph.tsx";
import { MessageMarkdown } from "./message-markdown.tsx";
import "../agent-workspace.css";

type Entry = AgentWorkspaceListing["entries"][number];
export function AgentWorkspaceBrowser({
  client,
  agentId,
}: {
  client: RahClient;
  agentId: string;
}) {
  const [hidden, setHidden] = useState(() => {
      try {
        return (
          localStorage.getItem(`rah:workspace-hidden:${agentId}`) === "true"
        );
      } catch {
        return false;
      }
    }),
    [revision, setRevision] = useState(0);
  const rootId = "agent-workspace" as const;
  const [root, setRoot] = useState<AgentWorkspaceListing>();
  const [selected, setSelected] = useState<string>();
  const [file, setFile] = useState<AgentWorkspaceFile>();
  const [error, setError] = useState<string>(),
    [copy, setCopy] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  const [treeWidth, setTreeWidth] = useState(256);
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const copyGeneration = useRef(0);
  useEffect(
    () => () => {
      copyGeneration.current++;
      clearTimeout(copyTimer.current);
    },
    [],
  );
  useEffect(() => {
    try {
      setHidden(
        localStorage.getItem(`rah:workspace-hidden:${agentId}`) === "true",
      );
    } catch {
      setHidden(false);
    }
  }, [agentId]);
  useEffect(() => {
    const controller = new AbortController();
    setFile(undefined);
    setError(undefined);
    if (selected)
      void client
        .request(
          "agent.workspace.read",
          { agentId, rootId, path: selected },
          { signal: controller.signal },
        )
        .then((value) => {
          if (!controller.signal.aborted) setFile(value);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError(
              "无法预览：文件受保护、超过大小限制或已变化。请刷新后重试。",
            );
        });
    return () => controller.abort();
  }, [client, agentId, rootId, selected, revision]);
  const selectFile = (path: string) => {
    setViewMode("preview");
    setSelected(path);
  };
  return (
    <section
      className="rah-workspace-browser"
      style={{ "--rah-tree-width": `${treeWidth}px` } as CSSProperties}
    >
      <header className="rah-workspace-path">
        <code>{root?.rootPath ?? ""}</code>
        <button
          title="复制路径"
          aria-label="复制路径"
          disabled={!root}
          onClick={() => {
            const generation = ++copyGeneration.current;
            clearTimeout(copyTimer.current);
            setCopy(false);
            setCopyError(undefined);
            void navigator.clipboard
              .writeText(root!.rootPath)
              .then(() => {
                if (generation !== copyGeneration.current) return;
                setCopy(true);
                copyTimer.current = setTimeout(() => setCopy(false), 1500);
              })
              .catch(() => {
                if (generation === copyGeneration.current)
                  setCopyError("无法复制路径");
              });
          }}
        >
          <Icon name="copy" />
        </button>
        {copy && <span role="status">已复制</span>}
        {copyError && <span role="status">{copyError}</span>}
      </header>
      <div
        className={`rah-workspace-columns${selected ? " has-selection" : ""}`}
      >
        <nav aria-label="工作区文件">
          <header>
            <b>工作区</b>
            <span>
              <button
                title={hidden ? "已显示隐藏文件" : "已隐藏隐藏文件"}
                aria-label={hidden ? "已显示隐藏文件" : "已隐藏隐藏文件"}
                aria-pressed={hidden}
                onClick={() => {
                  const next = !hidden;
                  setHidden(next);
                  try {
                    localStorage.setItem(
                      `rah:workspace-hidden:${agentId}`,
                      String(next),
                    );
                  } catch {
                    /* Browser storage denial does not block file browsing. */
                  }
                  setSelected(undefined);
                }}
              >
                <Icon name={hidden ? "eye" : "eye-off"} />
              </button>
              <button
                title="刷新"
                aria-label="刷新"
                onClick={() => setRevision((r) => r + 1)}
              >
                <Icon name="refresh-cw" />
              </button>
            </span>
          </header>
          <div
            role="tree"
            aria-label="Agent 工作区文件"
            onKeyDown={(e) => {
              const items = [
                ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="treeitem"]',
                ),
              ];
              const at = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                items[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            items.length - 1,
                            at + (e.key === "ArrowDown" ? 1 : -1),
                          ),
                        )
                ]?.focus();
              }
            }}
          >
            <Directory
              key={`${agentId}:${rootId}:${hidden}`}
              revision={revision}
              client={client}
              agentId={agentId}
              rootId={rootId}
              path=""
              depth={0}
              hidden={hidden}
              selected={selected}
              select={selectFile}
              onRoot={setRoot}
            />
          </div>
        </nav>
        <div
          className="rah-workspace-resizer"
          role="separator"
          aria-label="调整文件树宽度"
          aria-orientation="vertical"
          aria-valuemin={160}
          aria-valuemax={600}
          aria-valuenow={treeWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            drag.current = { x: event.clientX, width: treeWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (drag.current)
              setTreeWidth(
                Math.max(
                  160,
                  Math.min(
                    600,
                    drag.current.width + event.clientX - drag.current.x,
                  ),
                ),
              );
          }}
          onPointerUp={(event) => {
            drag.current = undefined;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              setTreeWidth((width) =>
                event.key === "Home"
                  ? 160
                  : event.key === "End"
                    ? 600
                    : Math.max(
                        160,
                        Math.min(
                          600,
                          width + (event.key === "ArrowLeft" ? -16 : 16),
                        ),
                      ),
              );
            }
          }}
        />
        <section className="rah-workspace-preview" aria-label="文件预览">
          {selected ? (
            <>
              <header>
                <code>{selected}</code>
                {selected.endsWith(".md") && (
                  <span
                    className="rah-workspace-view-mode"
                    role="group"
                    aria-label="工作区文件查看模式"
                  >
                    <button
                      aria-pressed={viewMode === "raw"}
                      onClick={() => setViewMode("raw")}
                    >
                      源码
                    </button>
                    <button
                      aria-pressed={viewMode === "preview"}
                      onClick={() => setViewMode("preview")}
                    >
                      预览
                    </button>
                  </span>
                )}
                <button
                  aria-label="关闭文件预览"
                  onClick={() => setSelected(undefined)}
                >
                  <Icon name="x" />
                </button>
              </header>
              {error ? (
                <p role="alert">{error}</p>
              ) : !file ? (
                <p role="status">正在读取文件…</p>
              ) : file.encoding === "utf-8" ? (
                selected.endsWith(".md") && viewMode === "preview" ? (
                  <div className="rah-workspace-markdown">
                    <MessageMarkdown source={file.content ?? ""} />
                  </div>
                ) : (
                  <pre>{file.content}</pre>
                )
              ) : file.encoding === "base64" &&
                file.mimeType.startsWith("image/") ? (
                <img
                  alt={selected}
                  src={`data:${file.mimeType};base64,${file.content}`}
                />
              ) : (
                <p>无法预览此二进制文件（{file.size} 字节）。</p>
              )}
            </>
          ) : (
            <p className="rah-workspace-empty">
              <span>
                <FileGlyph kind="file" />
                选择一个文件查看
              </span>
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
function Directory({
  client,
  agentId,
  rootId,
  path,
  depth,
  hidden,
  selected,
  select,
  onRoot,
  revision,
}: {
  client: RahClient;
  agentId: string;
  rootId: AgentWorkspaceRoot["rootId"];
  path: string;
  depth: number;
  hidden: boolean;
  selected: string | undefined;
  select: (path: string) => void;
  onRoot?: (root: AgentWorkspaceListing) => void;
  revision: number;
}) {
  const [listing, setListing] = useState<AgentWorkspaceListing>(),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);
  const rootCallback = useRef(onRoot);
  rootCallback.current = onRoot;
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void client
      .request(
        "agent.workspace.list",
        { agentId, rootId, path, includeHidden: hidden },
        { signal: controller.signal },
      )
      .then((value) => {
        if (!controller.signal.aborted) {
          setListing(value);
          rootCallback.current?.(value);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [client, agentId, rootId, path, hidden, retry, revision]);
  if (error && !listing)
    return (
      <div role="alert">
        加载文件失败{" "}
        <button onClick={() => setRetry((r) => r + 1)}>重试</button>
      </div>
    );
  if (!listing) return <p role="status">正在加载…</p>;
  if (listing.state === "absent") return <p>尚未建立 Agent 私有目录。</p>;
  const toggle = (entry: Entry, open?: boolean) =>
    setExpanded((values) =>
      (open ?? !values.includes(entry.path))
        ? [...new Set([...values, entry.path])]
        : values.filter((p) => p !== entry.path),
    );
  return (
    <>
      {error && (
        <div role="alert">
          刷新失败，保留上次目录。
          <button onClick={() => setRetry((r) => r + 1)}>重试</button>
        </div>
      )}
      {listing.entries.length === 0 && <p>空文件夹</p>}
      {listing.entries.map((entry) => (
        <div key={entry.path} role="none">
          <button
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={selected === entry.path}
            aria-expanded={
              entry.isDirectory ? expanded.includes(entry.path) : undefined
            }
            className="rah-workspace-entry"
            data-hidden={entry.isHidden || undefined}
            style={{ paddingLeft: (entry.isDirectory ? 8 : 22) + depth * 16 }}
            onClick={() =>
              entry.isDirectory ? toggle(entry) : select(entry.path)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                entry.isDirectory ? toggle(entry) : select(entry.path);
              }
              if (e.key === "ArrowRight" && entry.isDirectory) {
                e.preventDefault();
                if (!expanded.includes(entry.path)) toggle(entry, true);
                else
                  e.currentTarget.parentElement
                    ?.querySelector<HTMLElement>(
                      '[role="group"] [role="treeitem"]',
                    )
                    ?.focus();
              }
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                if (entry.isDirectory && expanded.includes(entry.path))
                  toggle(entry, false);
                else
                  e.currentTarget
                    .closest('[role="group"]')
                    ?.parentElement?.querySelector<HTMLElement>(
                      '[role="treeitem"]',
                    )
                    ?.focus();
              }
            }}
          >
            {entry.isDirectory ? (
              <>
                <Icon
                  name={
                    expanded.includes(entry.path)
                      ? "chevron-down"
                      : "chevron-right"
                  }
                />
                <Icon
                  className="rah-workspace-folder-icon"
                  name={
                    expanded.includes(entry.path)
                      ? "folder-open"
                      : "folder-closed"
                  }
                />
              </>
            ) : (
              <Icon className="rah-workspace-file-icon" name="file-text" />
            )}
            <span>{entry.name}</span>
          </button>
          {entry.isDirectory && expanded.includes(entry.path) && (
            <div role="group">
              <Directory
                client={client}
                agentId={agentId}
                rootId={rootId}
                path={entry.path}
                revision={revision}
                depth={depth + 1}
                hidden={hidden}
                selected={selected}
                select={select}
              />
            </div>
          )}
        </div>
      ))}
      {listing.truncated && (
        <p role="status">目录过大，仅显示部分条目；请进入子目录浏览。</p>
      )}
    </>
  );
}
