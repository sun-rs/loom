import { SelectField } from "./ManagementUi.tsx";
import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { ComputerFilesListResponse } from "@rah-os/protocol";
import {
  Button,
  Dialog,
  DialogContent,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "raft-ui";
import { Folder, File, ArrowLeft, Check } from "lucide-react";
import SelectionPopover from "../packages/web/src/components/ui/SelectionPopover.tsx";
export default function ComputerFiles({
  client,
  onClose,
  onSelect,
}: {
  client: RahClient;
  onClose: () => void;
  onSelect: (paths: string[]) => void;
}) {
  const [location, setLocation] = useState<{
    rootId?: string;
    path: string;
    hostId?: string;
  }>({ path: "" });
  const [hidden, setHidden] = useState(false),
    [data, setData] = useState<ComputerFilesListResponse>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(undefined);
    setSelected([]);
    void client
      .request(
        "computer.files.list",
        { ...location, includeHidden: hidden },
        { signal: controller.signal },
      )
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, location, hidden, revision]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-label="引用计算机文件或文件夹"
        className="flex max-h-[80dvh] flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>引用计算机文件或文件夹</DialogTitle>
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-auto">
          {data && (
            <>
              <SelectField
                label="计算机"
                value={data.hostId}
                onChange={(hostId) => setLocation({ hostId, path: "" })}
                options={[
                  { value: data.hostId, label: data.label + "（本机）" },
                ]}
              />
              <p className="text-xs text-foreground-muted">
                当前仅本机支持文件浏览
              </p>
              {data.roots.length > 1 && (
                <SelectField
                  label="授权目录"
                  value={data.rootId}
                  onChange={(rootId) =>
                    setLocation({ hostId: data.hostId, rootId, path: "" })
                  }
                  options={data.roots.map((r) => ({
                    value: r.rootId,
                    label: r.label,
                  }))}
                />
              )}
              <div className="flex items-center gap-2 py-2">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="上一级目录"
                  disabled={!data.path}
                  onClick={() =>
                    setLocation({
                      hostId: data.hostId,
                      rootId: data.rootId,
                      path: data.path.split("/").slice(0, -1).join("/"),
                    })
                  }
                >
                  <ArrowLeft size={14} />
                </Button>
                <code
                  className="min-w-0 truncate text-xs"
                  title={data.absolutePath}
                >
                  {data.absolutePath}
                </code>
              </div>
            </>
          )}
          <label className="text-xs">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />{" "}
            显示隐藏文件
          </label>
          {loading ? (
            <p role="status">加载中…</p>
          ) : error ? (
            <p role="alert">
              {error}
              <Button onClick={() => setRevision((v) => v + 1)}>重试</Button>
            </p>
          ) : (
            data && (
              <SelectionPopover
                title="文件"
                showHeader={false}
                className="w-full"
                emptyLabel="此目录为空"
                options={data.entries.map((e) => ({
                  key: e.path,
                  label: e.name,
                  checked: selected.includes(e.absolutePath),
                  leading: e.isDirectory ? (
                    <Folder size={16} />
                  ) : (
                    <File size={16} />
                  ),
                  onClick: () =>
                    e.isDirectory
                      ? setLocation({
                          hostId: data.hostId,
                          rootId: data.rootId,
                          path: e.path,
                        })
                      : setSelected((s) =>
                          s.includes(e.absolutePath)
                            ? s.filter((p) => p !== e.absolutePath)
                            : [...s, e.absolutePath],
                        ),
                }))}
              />
            )
          )}
          {data?.truncated && <p role="status">目录过大，仅显示前1000项。</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={loading || !!error || !data}
            onClick={() =>
              data && onSelect(selected.length ? selected : [data.absolutePath])
            }
          >
            <Check size={14} />
            引用所选
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
