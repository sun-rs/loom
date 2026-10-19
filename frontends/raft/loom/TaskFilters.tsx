import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Room } from "@rah-os/protocol";
import { Hash, UserCircle2, User } from "lucide-react";
import { Button } from "raft-ui";
import TaskFilterPicker from "./TaskFilterPicker.tsx";
import MentionAvatar from "./MentionAvatar.tsx";
import type { TaskFilterKey } from "./task-filters.ts";
export default function TaskFilters({
  client,
  workspaceId,
  rooms,
  params,
  onChange,
  channelMode,
  onClear,
}: {
  client: RahClient;
  workspaceId: string;
  rooms: Room[];
  params: URLSearchParams;
  onChange: (key: TaskFilterKey, values: string[]) => void;
  channelMode: boolean;
  onClear: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [directory, setDirectory] = useState<{
    principals: Principal[];
    selfId: string;
  }>();
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setDirectory(undefined);
    setFailed(false);
    void Promise.all([
      client.request(
        "search",
        { workspaceId, query: "", limit: 1 },
        { signal: abort.signal },
      ),
      client.request("principal.me", {}, { signal: abort.signal }),
    ])
      .then(([data, me]) => {
        if (!abort.signal.aborted)
          setDirectory({
            principals: data.principals,
            selfId: me.principal.principalId,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [client, workspaceId, retry]);
  const identities = (directory?.principals ?? [])
    .filter((p) => p.principalId !== directory?.selfId)
    .sort((a, b) =>
      (a.displayName ?? a.handle).localeCompare(
        b.displayName ?? b.handle,
        undefined,
        { sensitivity: "base" },
      ),
    )
    .map((p) => ({
      key: p.principalId,
      label: p.displayName ?? p.handle,
      handle: p.handle,
      avatar: (
        <MentionAvatar
          context="compact-list"
          type={p.kind === "agent" ? "agent" : "human"}
        />
      ),
    }));
  return (
    <>
      {!channelMode && (
        <TaskFilterPicker
          label="频道"
          icon={<Hash size={14} />}
          options={[...rooms]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((r) => ({ key: r.roomId, label: `#${r.name}` }))}
          selected={params.getAll("taskRoom")}
          onChange={(v) => onChange("taskRoom", v)}
          open={open === "room"}
          onOpenChange={(v) => setOpen(v ? "room" : null)}
        />
      )}
      {(["creator", "assignee"] as const).map((kind) => (
        <TaskFilterPicker
          key={kind}
          label={kind === "creator" ? "创建者" : "负责人"}
          icon={
            kind === "creator" ? <UserCircle2 size={14} /> : <User size={14} />
          }
          reserveLeadingSlot
          disabled={!directory}
          options={[
            ...(directory
              ? [
                  {
                    key: directory.selfId,
                    label: kind === "creator" ? "我创建的" : "分配给我的",
                    sentinel: true,
                  },
                ]
              : []),
            ...(kind === "assignee"
              ? [{ key: "unassigned", label: "未分配", sentinel: true }]
              : []),
            ...identities,
          ]}
          selected={params.getAll(
            kind === "creator" ? "taskCreator" : "taskAssignee",
          )}
          onChange={(v) =>
            onChange(kind === "creator" ? "taskCreator" : "taskAssignee", v)
          }
          open={open === kind}
          onOpenChange={(v) => setOpen(v ? kind : null)}
        />
      ))}
      {(params.has("taskCreator") ||
        params.has("taskAssignee") ||
        (!channelMode && params.has("taskRoom"))) && (
        <Button size="sm" variant="ghost" type="button" onClick={onClear}>
          清除筛选
        </Button>
      )}
      {failed && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRetry((v) => v + 1)}
        >
          筛选成员读取失败，重试
        </Button>
      )}
    </>
  );
}
