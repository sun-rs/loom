import {
  DialogSheetContent,
  DialogCommit,
  DialogFooterNote,
} from "raft-ui/wip";
import { uiActionProps } from "./ui-action-props.ts";
import DeviceFileUpload from "./DeviceFileUpload.tsx";
import { SelectField } from "./ManagementUi.tsx";
import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { ComputerFilesListResponse } from "@rah-os/protocol";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogClose,
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
  uploadDisabled,
  onUpload,
  foldersOnly = false,
}: {
  client: RahClient;
  foldersOnly?: boolean;
  uploadDisabled?: boolean;
  onUpload?: (files: FileList) => void;
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
    setSelected([]);
    const timeout = setTimeout(() => {
      controller.abort();
      setLoading(false);
      setError("目录读取超时，请重试。");
    }, 10000);
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
        clearTimeout(timeout);
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [client, location, hidden, revision]);
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogSheetContent
        data-testid="computer-file-dialog"
        aria-label={foldersOnly ? "选择工作区文件夹" : "引用计算机文件或文件夹"}
        className="flex min-h-[min(512px,80dvh)] max-h-[80dvh] flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>
            {foldersOnly ? "选择工作区文件夹" : "引用文件或文件夹"}
          </DialogTitle>
          <DialogClose aria-label="关闭文件选择" />
        </DialogHeader>
        <DialogBody className="min-h-0 flex-initial overflow-auto">
          {data && (
            <>
              <SelectField
                label="计算机"
                value={data.hostId}
                onChange={(hostId) => setLocation({ hostId, path: "" })}
                options={[
                  { value: data.hostId, label: data.label + "（Loom 主机）" },
                ]}
              />
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
                <code
                  className="min-w-0 truncate text-xs"
                  title={data.absolutePath}
                >
                  {data.absolutePath}
                </code>
              </div>
            </>
          )}
          <Card
            data-testid="computer-file-tree"
            className="flex h-64 min-h-64 flex-col overflow-hidden"
          >
            <div className="shrink-0 border-b border-line-muted ">
              <SelectionPopover
                title="导航"
                showHeader={false}
                className="border-0 shadow-none  "
                options={[
                  {
                    key: "parent",
                    label: "上一级目录",
                    checked: false,
                    disabled: !data?.path || loading,
                    leading: <ArrowLeft size={16} />,
                    onClick: () =>
                      data &&
                      setLocation({
                        hostId: data.hostId,
                        rootId: data.rootId,
                        path: data.path.split("/").slice(0, -1).join("/"),
                      }),
                  },
                ]}
              />
            </div>
            <div
              data-testid="computer-file-entries"
              className="min-h-0 flex-1 overflow-auto"
            >
              {loading ? (
                <p
                  role="status"
                  className="px-3 py-3 text-xs text-foreground-muted"
                >
                  正在打开目录…
                </p>
              ) : error ? (
                <div role="alert" className="p-3 text-xs">
                  {error}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRevision((v) => v + 1)}
                  >
                    重试
                  </Button>
                </div>
              ) : (
                data && (
                  <SelectionPopover
                    title="文件"
                    showHeader={false}
                    className="border-0 shadow-none   [&>div]:max-h-none [&>div]:overflow-visible"
                    emptyLabel="此目录为空"
                    options={data.entries
                      .filter((e) => !foldersOnly || e.isDirectory)
                      .map((e) => ({
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
            </div>
          </Card>
          <label className="mt-3 flex items-center gap-2 text-xs">
            <Checkbox checked={hidden} onCheckedChange={setHidden} />
            显示隐藏文件
          </label>
          {data?.truncated && <p role="status">目录过大，仅显示前1000项。</p>}
        </DialogBody>
        <DialogFooter className="flex-wrap gap-2">
          {!foldersOnly && onUpload && (
            <DialogFooterNote>
              <DeviceFileUpload
                disabled={!!uploadDisabled}
                onFiles={onUpload}
              />
            </DialogFooterNote>
          )}
          <Button {...uiActionProps.secondary} onClick={onClose}>
            取消
          </Button>
          <DialogCommit
            {...uiActionProps.dialogSave}
            disabled={loading || !!error || !data}
            onClick={() =>
              data && onSelect(selected.length ? selected : [data.absolutePath])
            }
          >
            <Check size={14} />
            {foldersOnly ? "选择此文件夹" : "引用所选"}
          </DialogCommit>
        </DialogFooter>
      </DialogSheetContent>
    </Dialog>
  );
}
