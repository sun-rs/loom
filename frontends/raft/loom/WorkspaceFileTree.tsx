import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  AgentWorkspaceRoot,
  AgentWorkspaceListing,
} from "@rah-os/protocol";
import { TreeNode, type DirTruncation } from "./WorkspaceNativeParts.tsx";
export default function WorkspaceFileTree({
  client,
  roomId,
  rootId,
  hidden,
  selectedPath,
  onSelect,
}: {
  client: RahClient;
  roomId: string;
  rootId: AgentWorkspaceRoot["rootId"];
  hidden: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [directories, setDirectories] = useState(
      new Map<string, AgentWorkspaceListing>(),
    ),
    [expanded, setExpanded] = useState(new Set<string>()),
    [loading, setLoading] = useState(new Set<string>()),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    pending = useRef(new Set<string>());
  const load = (path: string) => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || pending.current.has(path)) return;
    pending.current.add(path);
    setLoading((s) => new Set(s).add(path));
    void client
      .request(
        "channel.workspace.read",
        { roomId, rootId, path, includeHidden: hidden, operation: "list" },
        { signal },
      )
      .then((r) => {
        if (!signal.aborted && r.kind === "list")
          setDirectories((s) => new Map(s).set(path, r.value));
      })
      .catch((e) => {
        if (!signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!signal.aborted) {
          pending.current.delete(path);
          setLoading((s) => {
            const n = new Set(s);
            n.delete(path);
            return n;
          });
        }
      });
  };
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    load("");
    return () => abort.abort();
  }, []);
  const truncation = (path: string): DirTruncation | undefined => {
    const d = directories.get(path);
    return d?.truncated
      ? { shown: d.entries.length, omitted: null }
      : undefined;
  };
  return (
    <>
      {error && (
        <p role="alert" className="px-3 py-2 text-sm text-danger">
          {error}，请刷新重试。
        </p>
      )}
      {loading.has("") ? (
        <p
          role="status"
          className="px-3 py-4 text-center text-sm font-mono text-foreground-muted"
        >
          加载中…
        </p>
      ) : directories.get("")?.entries.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-foreground-muted">
          空目录
        </p>
      ) : (
        directories.get("")?.entries.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            expandedDirs={expanded}
            loadingDirs={loading}
            loadingLabel="加载中…"
            getChildren={(p) => directories.get(p)?.entries}
            getTruncation={truncation}
            onSelectFile={onSelect}
            onToggleDir={(p) => {
              setExpanded((s) => {
                const next = new Set(s);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              });
              if (!expanded.has(p) && !directories.has(p)) load(p);
            }}
          />
        ))
      )}
      {directories.get("")?.truncated && (
        <p className="px-3 py-2 text-xs text-foreground-muted">
          目录过大，仅显示首批项目。
        </p>
      )}
    </>
  );
}
