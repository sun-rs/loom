import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { RahClient } from "@rah-os/client-sdk";
import type { ComputerFilesListResponse } from "@rah-os/protocol";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { ChoiceRow } from "@rah-os/ui-web/neo-brutalist/choice-row";
import { useDialogProtocol } from "../dialog-protocol.ts";
import "../composer-controls.css";

export function ComposerComputerFiles({
  client,
  conversationLabel,
  onClose,
  onSelect,
}: {
  client: RahClient;
  conversationLabel: string;
  onClose: () => void;
  onSelect: (paths: string[]) => void;
}) {
  const dialog = useDialogProtocol({
    blocked: false,
    initialFocus: "container",
    onClose,
  });
  const [location, setLocation] = useState({
    path: "",
    rootId: undefined as string | undefined,
    absolutePath: undefined as string | undefined,
  });
  const [hidden, setHidden] = useState(false);
  const [listing, setListing] = useState<ComputerFilesListResponse>();
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSelected([]);
    setError(undefined);
    void client
      .request(
        "computer.files.list",
        {
          path: location.path,
          ...(location.rootId ? { rootId: location.rootId } : {}),
          includeHidden: hidden,
        },
        { signal: controller.signal },
      )
      .then((value) => {
        if (!controller.signal.aborted) {
          setListing(value);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "无法读取目录");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [client, location, hidden, revision]);
  function choose(paths: string[]) {
    onSelect(paths);
    onClose();
  }
  function navigate(next: typeof location) {
    setLoading(true);
    setError(undefined);
    setSelected([]);
    setLocation(next);
  }
  const currentPath = location.absolutePath
    ? location.path
    : (listing?.path ?? location.path);
  const absolutePath = location.absolutePath ?? listing?.absolutePath ?? "";
  return createPortal(
    <div
      className="rah-dialog-layer rah-computer-file-layer"
      role="presentation"
    >
      <button
        className="rah-dialog-backdrop"
        type="button"
        aria-label="关闭文件选择窗口"
        onClick={onClose}
      />
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="引用计算机文件或文件夹"
        tabIndex={-1}
        className="rah-dialog-frame rah-computer-file-dialog"
        data-mobile-presentation="compact"
        data-fixed-height="true"
      >
        <header className="rah-dialog-header">
          <div>
            <span>{conversationLabel}</span>
            <h2>引用文件或文件夹</h2>
          </div>
          <PanelHeaderAction aria-label="关闭文件浏览" onClick={onClose}>
            <Icon name="x" />
          </PanelHeaderAction>
        </header>
        <div className="rah-computer-file-controls">
          <span className="rah-computer-file-host" aria-label="计算机">
            <Icon name="monitor" />
            {listing?.label ?? "当前计算机"}
            <button
              className="rah-inline-icon-action"
              type="button"
              aria-label="返回用户主目录"
              title="返回用户主目录"
              onClick={() =>
                navigate({
                  path: "",
                  rootId: undefined,
                  absolutePath: undefined,
                })
              }
            >
              <Icon name="home" />
            </button>
          </span>
          <label>
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => {
                setLoading(true);
                setHidden(e.target.checked);
              }}
            />
            隐藏文件
          </label>
        </div>
        <div className="rah-computer-file-path">
          <button
            type="button"
            className="sq-btn"
            aria-label="上一级目录"
            disabled={!currentPath}
            onClick={() =>
              navigate({
                rootId: listing?.rootId ?? location.rootId,
                path: currentPath.split("/").slice(0, -1).join("/"),
                absolutePath:
                  absolutePath.split("/").slice(0, -1).join("/") || "/",
              })
            }
          >
            <Icon name="arrow-left" />
          </button>
          <code title={absolutePath}>{absolutePath}</code>
        </div>
        <div className="rah-computer-file-list" aria-busy={loading}>
          {error ? (
            <div role="alert">
              {error}
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setError(undefined);
                  setRevision((n) => n + 1);
                }}
              >
                重试
              </button>
            </div>
          ) : loading || !listing ? (
            <p role="status">正在读取目录…</p>
          ) : (
            <>
              {listing.entries.length === 0 && <p>此目录为空</p>}
              {listing.entries.map((entry) => (
                <div className="rah-computer-file-row" key={entry.path}>
                  <ChoiceRow
                    profile="property-option"
                    current={selected.includes(entry.absolutePath)}
                    aria-label={
                      entry.isDirectory
                        ? `打开文件夹 ${entry.name}`
                        : entry.name
                    }
                    aria-pressed={selected.includes(entry.absolutePath)}
                    title={entry.absolutePath}
                    onClick={() => {
                      if (entry.isDirectory)
                        navigate({
                          path: entry.path,
                          rootId: listing.rootId,
                          absolutePath: entry.absolutePath,
                        });
                      else
                        setSelected((paths) =>
                          paths.includes(entry.absolutePath)
                            ? paths.filter(
                                (path) => path !== entry.absolutePath,
                              )
                            : [...paths, entry.absolutePath],
                        );
                    }}
                  >
                    <Icon
                      name={entry.isDirectory ? "folder-closed" : "file-text"}
                    />
                    <span>{entry.name}</span>
                    {selected.includes(entry.absolutePath) && (
                      <Icon name="check" />
                    )}
                  </ChoiceRow>
                </div>
              ))}
              {listing.truncated && (
                <p role="status">目录条目过多，仅显示前 1000 项。</p>
              )}
            </>
          )}
        </div>
        <footer>
          <div className="rah-computer-file-confirm">
            <button
              type="button"
              className="btn btn-pink"
              disabled={loading || !!error || !listing}
              onClick={() =>
                !loading &&
                !error &&
                listing &&
                choose(selected.length ? selected : [listing.absolutePath])
              }
            >
              <Icon name="check" />
              引用所选
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
