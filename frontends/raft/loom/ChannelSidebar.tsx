import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Button, Input, Textarea } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  Room,
  SidebarPreferences,
  SidebarPatchRequest,
} from "@rah-os/protocol";
import type { IntentOutcome } from "@rah-os/client-core/write-intent";
import Frame from "../packages/web/src/components/server/PublicServerSidebarFrame.tsx";
import Row from "../packages/web/src/components/server/PublicServerChannelRow.tsx";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import { ManagementClient } from "./management-client.ts";
import {
  ActionDialog,
  ActionMenu,
  OperationStatus,
  useManagement,
} from "./ManagementUi.tsx";
import {
  sidebarGroups,
  moveChannel,
  reorderChannel,
  reorderSection,
} from "./sidebar-state.ts";
type Edit =
  | { kind: "channel" }
  | { kind: "group"; id?: string }
  | { kind: "delete-group"; id: string };
export default function ChannelSidebar({
  client,
  workspaceId,
  controlRoomId,
  name,
  rooms,
  selected,
  onSelect,
  onCreated,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  name: string;
  rooms: Room[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCreated: (room: Room) => Promise<void>;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const { state, error, setError } = useManagement(manager);
  const [data, setData] = useState<{
    preferences: SidebarPreferences;
    recent: Record<string, string>;
  }>();
  const [edit, setEdit] = useState<Edit>();
  const [title, setTitle] = useState("");
  const [directories, setDirectories] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const request = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    setRefreshing(true);
    try {
      const next = await client.request("sidebar.get", { workspaceId });
      if (ticket === request.current) setData(next);
    } catch {
      if (ticket === request.current)
        setError("频道列表设置读取失败，请重试。");
    } finally {
      if (ticket === request.current) setRefreshing(false);
    }
  }, [client, workspaceId, setError]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const done = (outcome: IntentOutcome<unknown>) => {
    if (outcome.kind === "ok") {
      setEdit(undefined);
      setError("");
      void refresh();
    } else if (outcome.kind === "rejected") {
      setError("操作未成功，已刷新列表设置；请检查后重新操作。");
      void refresh();
    }
  };
  const patch = (value: SidebarPatchRequest["patch"]) => {
    if (data && state === "idle") {
      setError("");
      void manager.sidebar(value, data.preferences.version, done);
    }
  };
  const open = (next: Edit, value = "") => {
    setError("");
    setTitle(value);
    setDirectories("");
    setEdit(next);
  };
  const groups = data
    ? sidebarGroups(rooms, data.preferences, data.recent)
    : [];
  const prefs = data?.preferences;
  const busy = state !== "idle" || refreshing;
  const visibleGroups = groups.filter(
    (g) => g.id !== "pinned" || g.rooms.length,
  );
  const reorder = (id: string, direction: number) =>
    patch(
      reorderSection(
        prefs!,
        visibleGroups.map((g) => g.id),
        id,
        direction,
      ),
    );
  return (
    <Frame
      title={name}
      testIdPrefix="public-server-channel-sidebar"
      scrollTestId="public-server-channel-list"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-bold">频道</span>
        <ActionMenu
          label="频道列表操作"
          disabled={busy || !prefs}
          items={[
            { label: "新建频道", run: () => open({ kind: "channel" }) },
            { label: "新建分组", run: () => open({ kind: "group" }) },
            {
              label: "手动排序",
              run: () =>
                patch({ channelSortMode: "manual", pinnedSortMode: "manual" }),
            },
            {
              label: "按名称排序",
              run: () => patch({ channelSortMode: "az", pinnedSortMode: "az" }),
            },
            {
              label: "按最近活动排序",
              run: () =>
                patch({ channelSortMode: "recent", pinnedSortMode: "recent" }),
            },
          ]}
        />
      </div>
      {!edit && <OperationStatus manager={manager} error={error} />}
      {error && (
        <Button variant="ghost" onClick={() => void refresh()}>
          刷新列表
        </Button>
      )}
      {!data && <p className="px-2 text-xs">正在读取列表设置…</p>}
      {visibleGroups.map((group) => (
        <section
          key={group.id}
          data-sidebar-section={group.id}
          className="mb-3"
        >
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start truncate"
              aria-expanded={!collapsed.includes(group.id)}
              onClick={() =>
                setCollapsed((current) =>
                  current.includes(group.id)
                    ? current.filter((id) => id !== group.id)
                    : [...current, group.id],
                )
              }
            >
              {group.name}
            </Button>
            <ActionMenu
              label={`分组操作 ${group.name}`}
              disabled={busy}
              items={[
                ...(group.id.startsWith("custom:")
                  ? [
                      {
                        label: "重命名分组",
                        run: () =>
                          open(
                            { kind: "group", id: group.id.slice(7) },
                            group.name,
                          ),
                      },
                      {
                        label: "删除分组",
                        run: () =>
                          open(
                            { kind: "delete-group", id: group.id.slice(7) },
                            group.name,
                          ),
                      },
                    ]
                  : []),
                {
                  label: "分组上移",
                  disabled: visibleGroups[0]?.id === group.id,
                  run: () => reorder(group.id, -1),
                },
                {
                  label: "分组下移",
                  disabled: visibleGroups.at(-1)?.id === group.id,
                  run: () => reorder(group.id, 1),
                },
              ]}
            />
          </div>
          {!collapsed.includes(group.id) &&
            group.rooms.map((room, index) => (
              <div
                key={room.roomId}
                className="flex min-w-0 items-center"
                data-channel-row={room.roomId}
              >
                <div className="min-w-0 flex-1">
                  <Row
                    channelId={room.roomId}
                    name={room.name}
                    selected={selected === room.roomId}
                    onSelectChannel={onSelect}
                  />
                </div>
                <ActionMenu
                  label={`频道操作 ${room.name}`}
                  disabled={busy}
                  items={[
                    {
                      label: prefs!.pinned.includes(`room:${room.roomId}`)
                        ? "取消置顶"
                        : "置顶",
                      run: () =>
                        patch(
                          prefs!.pinned.includes(`room:${room.roomId}`)
                            ? {
                                pinned: prefs!.pinned.filter(
                                  (k) => k !== `room:${room.roomId}`,
                                ),
                              }
                            : moveChannel(prefs!, room.roomId, "pinned"),
                        ),
                    },
                    ...groups
                      .filter((g) => g.id !== "pinned" && g.id !== group.id)
                      .map((g) => ({
                        label: `移至 ${g.name}`,
                        run: () =>
                          patch(moveChannel(prefs!, room.roomId, g.id)),
                      })),
                    {
                      label: "上移",
                      disabled: index === 0,
                      run: () =>
                        patch(
                          reorderChannel(
                            prefs!,
                            group.id,
                            group.rooms.map((r) => r.roomId),
                            room.roomId,
                            -1,
                          ),
                        ),
                    },
                    {
                      label: "下移",
                      disabled: index === group.rooms.length - 1,
                      run: () =>
                        patch(
                          reorderChannel(
                            prefs!,
                            group.id,
                            group.rooms.map((r) => r.roomId),
                            room.roomId,
                            1,
                          ),
                        ),
                    },
                  ]}
                />
              </div>
            ))}
          {!collapsed.includes(group.id) && !group.rooms.length && (
            <p className="px-2 text-xs text-foreground-muted">暂无频道</p>
          )}
        </section>
      ))}
      {edit && (
        <ActionDialog
          title={
            edit.kind === "channel"
              ? "新建频道"
              : edit.kind === "delete-group"
                ? "删除分组"
                : edit.id
                  ? "重命名分组"
                  : "新建分组"
          }
          manager={manager}
          error={error}
          onClose={() => setEdit(undefined)}
        >
          {edit.kind === "delete-group" ? (
            <>
              <p className="mb-4">
                删除“{title}”分组？频道和历史保留，移回默认频道列表。
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  patch({
                    customSections: prefs!.customSections.filter(
                      (s) => s.id !== edit.id,
                    ),
                    sectionOrder: prefs!.sectionOrder.filter(
                      (id) => id !== `custom:${edit.id}`,
                    ),
                  })
                }
              >
                确认删除分组
              </Button>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || !title.trim()) return;
                if (edit.kind === "channel")
                  void manager.createChannel(
                    title.trim(),
                    directories
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    (outcome) => {
                      done(outcome);
                      if (outcome.kind === "ok")
                        void onCreated(outcome.result.room).catch(() =>
                          setError("频道已创建，列表更新失败，请刷新页面。"),
                        );
                    },
                  );
                else
                  patch({
                    customSections: edit.id
                      ? prefs!.customSections.map((s) =>
                          s.id === edit.id ? { ...s, name: title.trim() } : s,
                        )
                      : [
                          ...prefs!.customSections,
                          {
                            id: crypto.randomUUID(),
                            name: title.trim(),
                            items: [],
                          },
                        ],
                  });
              }}
            >
              <FormField label="名称">
                <Input
                  aria-label="名称"
                  autoFocus
                  value={title}
                  maxLength={edit.kind === "channel" ? 200 : 80}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </FormField>
              {edit.kind === "channel" && (
                <>
                  <p className="my-3 text-sm">Loom 自动创建频道工作目录。</p>
                  <details className="mb-3">
                    <summary className="cursor-pointer text-sm">
                      附加本机目录（可选）
                    </summary>
                    <p className="my-2 text-xs">
                      每行一个绝对路径，创建后固定。实例可访问这些目录。
                    </p>
                    <Textarea
                      aria-label="附加本机目录"
                      value={directories}
                      onChange={(e) => setDirectories(e.target.value)}
                      disabled={busy}
                    />
                  </details>
                </>
              )}
              <Button
                className="mt-3"
                type="submit"
                disabled={busy || !title.trim()}
              >
                {edit.kind === "channel" ? "创建频道" : "保存分组"}
              </Button>
            </form>
          )}
        </ActionDialog>
      )}
    </Frame>
  );
}
