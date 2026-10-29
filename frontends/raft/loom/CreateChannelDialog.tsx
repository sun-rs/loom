import { useEffect, useRef, useState } from "react";
import { Button, Badge } from "raft-ui";
import { DialogCommit } from "raft-ui/wip";
import { Folder, Plus, X } from "lucide-react";
import type { Room } from "@rah-os/protocol";
import type { Catalog, ManagementClient } from "./management-client.ts";
import { OperationStatus } from "./ManagementUi.tsx";
import MobileFormDialog from "./MobileFormDialog.tsx";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import ComputerFiles from "./ComputerFiles.tsx";
import { OfficialCreateChannelFields } from "./OfficialCreateChannelFields.generated.tsx";
import { uiActionProps } from "./ui-action-props.ts";
/** UI draft only. Each write uses the existing causal/idempotent intent slot. */
export default function CreateChannelDialog({
  manager,
  onClose,
  onCreated,
}: {
  manager: ManagementClient;
  onClose: () => void;
  onCreated: (room: Room) => Promise<void>;
}) {
  const [state, setState] = useState(manager.writes.state),
    [error, setError] = useState("");
  useEffect(() => manager.writes.onChange(setState), [manager]);
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [directories, setDirectories] = useState<string[]>([]),
    [selecting, setSelecting] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>(),
    [readError, setReadError] = useState(false),
    [tick, setTick] = useState(0);
  const [members, setMembers] = useState(new Set<string>());
  const [created, setCreated] = useState<Room>();
  const remaining = useRef<string[]>([]);
  const busy = state !== "idle";
  useEffect(() => {
    let alive = true;
    setReadError(false);
    void manager
      .catalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch(() => {
        if (alive) setReadError(true);
      });
    return () => {
      alive = false;
    };
  }, [manager, tick]);
  const finish = async (room: Room) => {
    try {
      await onCreated(room);
      onClose();
    } catch {
      setError("频道已创建，刷新列表失败。请关闭后刷新，不要重新创建。");
    }
  };
  const addNext = (room: Room) => {
    const id = remaining.current[0];
    if (!id) {
      void finish(room);
      return;
    }
    void manager.instance("add", room.roomId, id, (outcome) => {
      if (outcome.kind === "ok") {
        remaining.current.shift();
        addNext(room);
      } else if (outcome.kind === "rejected")
        setError("频道已创建，部分成员未加入。可继续添加，不会重复创建频道。");
    });
  };
  const submit = () => {
    if (busy || !name.trim()) return;
    setError("");
    if (created) {
      addNext(created);
      return;
    }
    remaining.current = [...members];
    void manager.createChannel(
      name.trim(),
      directories,
      (outcome) => {
        if (outcome.kind === "ok") {
          setCreated(outcome.result.room);
          addNext(outcome.result.room);
        } else if (outcome.kind === "rejected")
          setError("频道未创建，请检查名称及工作区目录后重试。");
      },
      description.trim(),
    );
  };
  return (
    <>
      <MobileFormDialog
        title="新建频道"
        testId="loom-create-channel"
        busy={busy}
        onClose={onClose}
      >
        <form
          id="loom-create-channel-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={busy || !!created} className="space-y-4">
            <OfficialCreateChannelFields
              name={name}
              description={description}
              onName={setName}
              onDescription={setDescription}
              agents={(catalog?.roles ?? []).map((r) => ({
                id: r.roleId,
                name: r.configuration.displayName,
                avatarUrl: r.configuration.avatarKey,
              }))}
              selectedAgentIds={members}
              toggleAgent={(id) =>
                setMembers((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              workspace={
                <FormField label="工作区文件夹" optional>
                  <div className="flex flex-wrap items-center gap-2">
                    {directories.map((path) => (
                      <Badge key={path}>
                        <Folder size={14} />
                        <span className="max-w-64 truncate" title={path}>
                          {path}
                        </span>
                        <button
                          type="button"
                          aria-label={`移除文件夹 ${path}`}
                          onClick={() =>
                            setDirectories((current) =>
                              current.filter((p) => p !== path),
                            )
                          }
                        >
                          <X size={14} />
                        </button>
                      </Badge>
                    ))}
                    <Button
                      type="button"
                      {...uiActionProps.secondary}
                      aria-label="添加工作区文件夹"
                      onClick={() => setSelecting(true)}
                    >
                      <Plus size={16} />
                    </Button>
                  </div>
                </FormField>
              }
            />
          </fieldset>
          {readError && (
            <p role="alert">
              成员读取失败。
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTick((v) => v + 1)}
              >
                重试
              </Button>
            </p>
          )}
          {created && (
            <p role="status">
              频道已创建，尚有 {remaining.current.length} 位成员待加入。
            </p>
          )}
          <OperationStatus manager={manager} error={error} />
          <DialogCommit
            form="loom-create-channel-form"
            {...uiActionProps.dialogSave}
            type="submit"
            disabled={busy || !name.trim()}
          >
            {created ? "继续添加成员" : "创建频道"}
          </DialogCommit>
        </form>
      </MobileFormDialog>
      {selecting && (
        <ComputerFiles
          client={manager.client}
          foldersOnly
          onClose={() => setSelecting(false)}
          onSelect={(paths) => {
            setDirectories((current) => [...new Set([...current, ...paths])]);
            setSelecting(false);
          }}
        />
      )}
    </>
  );
}
