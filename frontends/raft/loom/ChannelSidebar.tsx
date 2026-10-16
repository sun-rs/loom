import SavedNav from "./SavedNav.tsx";
import { useAppearanceStore } from "../packages/web/src/store/appearanceStore.ts";
import { shouldHideEmptySidebarSection } from "../packages/web/src/components/layout/sidebarEmptySectionVisibility.ts";
import { LoomLiveActivity } from "./AppearanceRuntime.tsx";
import PrivateBoxRow from "./PrivateBoxRow.tsx";
import AttentionDot from "../packages/web/src/components/ui/AttentionDot.tsx";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { SidebarDrag, DragSection, DragRow } from "./SidebarDrag.tsx";
import ChannelArchiveDialog from "./ChannelArchiveDialog.tsx";
import { markChannelActivity } from "./sidebar-activity.ts";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Button, Input, Textarea } from "raft-ui";
import { Plus, ChevronRight } from "lucide-react";
import { SidebarContextMenu, SidebarSortMenu } from "./SidebarMenus.tsx";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  Room,
  SidebarPreferences,
  SidebarPatchRequest,
} from "@rah-os/protocol";
import type { IntentOutcome } from "@rah-os/client-core/write-intent";
import Frame from "./ChatSidebarFrame.tsx";
import Row from "./ChannelListRow.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import { ManagementClient } from "./management-client.ts";
import {
  ActionDialog,
  OperationStatus,
  useManagement,
} from "./ManagementUi.tsx";
import {
  sidebarGroups,
  sidebarKey,
  moveSidebarItem,
  groupSortMode,
  groupSortPatch,
} from "./sidebar-state.ts";
type Edit =
  | { kind: "channel" }
  | { kind: "group"; id?: string; moveKey?: string }
  | { kind: "delete-group"; id: string };
export default function ChannelSidebar({
  client,
  workspaceId,
  controlRoomId,
  name,
  rooms,
  archivedRooms,
  privateBoxes,
  onPrivateClosed,
  onRoomsChanged,
  onReady,
  selected,
  onSelect,
  savedSelected,
  onOpenSaved,
  onCreated,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  name: string;
  rooms: Room[];
  archivedRooms: Room[];
  privateBoxes: Room[];
  onPrivateClosed: (id: string) => void;
  onRoomsChanged: () => Promise<void>;
  onReady: () => void;
  savedSelected: boolean;
  onOpenSaved: () => void;
  selected: string | null;
  onSelect: (id: string) => boolean;
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
  const [activity, setActivity] = useState<Record<string, number>>();
  const [menuRoom, setMenuRoom] = useState<string>();
  const [marking, setMarking] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Room | "list">();
  const [edit, setEdit] = useState<Edit>();
  const [title, setTitle] = useState("");
  const [directories, setDirectories] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const request = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (data || error) onReady();
  }, [data, error, onReady]);
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
      const [next, activity] = await Promise.all([
        client.request("sidebar.get", { workspaceId }),
        client.request("activity.list", {
          workspaceId,
          filter: "all",
          limit: 1,
        }),
      ]);
      if (ticket === request.current) {
        setData(next);
        setActivity(
          Object.fromEntries(
            (activity.summary?.rooms ?? []).map((r) => [
              r.roomId,
              r.unreadCount,
            ]),
          ),
        );
      }
    } catch {
      if (ticket === request.current) {
        setActivity(undefined);
        setError("频道列表设置读取失败，请重试。");
      }
    } finally {
      if (ticket === request.current) setRefreshing(false);
    }
  }, [client, workspaceId, setError]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden && manager.writes.state === "idle") void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh, manager, privateBoxes]);
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
    ? sidebarGroups(
        [...rooms, ...privateBoxes],
        data.preferences,
        data.recent,
        activity,
      )
    : [];
  const prefs = data?.preferences;
  const busy = state !== "idle" || refreshing || marking;
  const mark = async (room: Room, action?: "read" | "unread") => {
    if (busy || !activity) return;
    setMarking(true);
    setError("");
    try {
      await markChannelActivity(
        client,
        room.roomId,
        action ?? (activity[room.roomId] ? "read" : "unread"),
      );
    } catch {
      setError("读状态未确认或已变化，未自动重发。请刷新检查当前状态。");
    } finally {
      await refresh();
      setMarking(false);
    }
  };
  const closePrivate = (room: Room) => {
    if (busy || !prefs || hasUnresolvedIntents()) return;
    setError("");
    void manager.sidebar(
      { hiddenDms: [...new Set([...prefs.hiddenDms, sidebarKey(room)])] },
      prefs.version,
      (outcome) => {
        done(outcome);
        if (outcome.kind === "ok") onPrivateClosed(room.roomId);
      },
    );
  };
  const archive = (room: Room, value: boolean) => {
    if (busy) return;
    setError("");
    void manager.archive(room.roomId, value, (outcome) => {
      if (outcome.kind === "ok") {
        setArchiveTarget(undefined);
        void onRoomsChanged()
          .then(refresh)
          .catch(() => setError("频道状态已更新，读取列表失败，请刷新页面。"));
      } else if (outcome.kind === "rejected")
        setError(`频道状态更新被拒绝：${String(outcome.error)}`);
    });
  };
  const hideEmpty = useAppearanceStore((s) => s.hideEmptySidebarSections);
  const visibleGroups = groups.filter(
    (g) =>
      !shouldHideEmptySidebarSection({
        hideEmptySections: hideEmpty,
        loading: !data,
        itemCount: g.rooms.length,
      }),
  );
  return (
    <Frame
      bottomSlot={<LoomLiveActivity />}
      title="聊天"
      testIdPrefix="public-server-channel-sidebar"
      scrollTestId="public-server-channel-list"
    >
      <SidebarContextMenu
        surface
        label="频道列表操作"
        disabled={busy || !prefs}
        items={[
          { label: "新建频道", run: () => open({ kind: "channel" }) },
          { label: "新建分组", run: () => open({ kind: "group" }) },
          {
            label: "已归档频道",
            run: () => {
              setError("");
              setArchiveTarget("list");
            },
          },
        ]}
      >
        {!edit && !archiveTarget && (
          <OperationStatus manager={manager} error={error} />
        )}
        {error && (
          <Button variant="ghost" onClick={() => void refresh()}>
            刷新列表
          </Button>
        )}
        <SavedNav
          client={client}
          workspaceId={workspaceId}
          active={savedSelected}
          onOpen={onOpenSaved}
        />
        <SidebarDrag
          groups={visibleGroups}
          prefs={prefs}
          disabled={busy}
          onDrop={(value, version) => {
            if (!busy) void manager.sidebar(value, version, done);
          }}
        >
          {visibleGroups.map((group) => (
            <DragSection
              key={group.id}
              id={group.id}
              items={group.rooms.map((r) => r.roomId)}
              disabled={busy}
            >
              <div className="mb-1 mt-3 flex h-6 items-center justify-between px-2">
                <SidebarContextMenu
                  label={`分组操作 ${group.name}`}
                  disabled={busy}
                  items={[
                    ...(group.id === "dms"
                      ? []
                      : [
                          {
                            label: "新建频道",
                            run: () => open({ kind: "channel" }),
                          },
                        ]),
                    ...(
                      [
                        ["manual", "手动排序"],
                        ["az", "按名称排序"],
                        ["recent", "按最近活动排序"],
                      ] as const
                    ).map(([mode, label]) => ({
                      label,
                      checked: groupSortMode(prefs!, group.id) === mode,
                      run: () => patch(groupSortPatch(group.id, mode)),
                    })),
                    { label: "新建分组", run: () => open({ kind: "group" }) },
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
                  ]}
                >
                  <button
                    type="button"
                    className="flex h-6 min-w-0 w-full items-center gap-1 [&>svg]:shrink-0 text-xs font-bold uppercase text-foreground-strong tracking-widest transition-colors hover:text-foreground-muted theme-brutal:text-black theme-brutal:hover:text-black/70"
                    data-section-handle
                    aria-expanded={!collapsed.includes(group.id)}
                    onClick={() =>
                      setCollapsed((current) =>
                        current.includes(group.id)
                          ? current.filter((id) => id !== group.id)
                          : [...current, group.id],
                      )
                    }
                  >
                    <ChevronRight
                      size={12}
                      className={`shrink-0 ${collapsed.includes(group.id) ? "" : "rotate-90"}`}
                    />
                    <span className="truncate">{group.name}</span>
                    {group.id === "dms" && (
                      <span className="text-foreground-placeholder font-mono normal-case tracking-normal theme-brutal:text-black/40">
                        {group.rooms.length}
                      </span>
                    )}
                    {group.id === "dms" &&
                      collapsed.includes(group.id) &&
                      group.rooms.some(
                        (r) => (activity?.[r.roomId] ?? 0) > 0,
                      ) && <AttentionDot size="lg" className="ml-1" />}
                  </button>
                </SidebarContextMenu>
                <div className="flex shrink-0 items-center gap-1">
                  <SidebarSortMenu
                    name={group.name}
                    disabled={busy}
                    value={groupSortMode(prefs!, group.id)}
                    onChange={(mode) => patch(groupSortPatch(group.id, mode))}
                  />
                  {group.id !== "dms" && (
                    <Tooltip content="新建频道">
                      <button
                        type="button"
                        className="btn-flat-sm flex size-6 items-center justify-center p-0"
                        aria-label="新建频道"
                        disabled={busy}
                        onClick={() => open({ kind: "channel" })}
                      >
                        <Plus size={14} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
              {!collapsed.includes(group.id) &&
                group.rooms.map((room) => (
                  <DragRow
                    key={room.roomId}
                    id={room.roomId}
                    disabled={
                      busy || groupSortMode(prefs!, group.id) !== "manual"
                    }
                  >
                    <SidebarContextMenu
                      label={`${room.instancePrivateBox ? "私聊" : "频道"}操作 ${room.name}`}
                      onOpenChange={(open) =>
                        setMenuRoom((current) =>
                          open
                            ? room.roomId
                            : current === room.roomId
                              ? undefined
                              : current,
                        )
                      }
                      disabled={busy}
                      items={[
                        {
                          label: "移动到分区",
                          children: [
                            ...groups
                              .filter((g) =>
                                room.instancePrivateBox
                                  ? g.id !== "channels"
                                  : g.id !== "dms",
                              )
                              .map((g) => ({
                                label: g.name,
                                checked: g.id === group.id,
                                disabled: g.id === group.id,
                                run: () =>
                                  patch(moveSidebarItem(prefs!, room, g.id)),
                              })),
                            {
                              label: "新建分组",
                              run: () =>
                                open({
                                  kind: "group",
                                  moveKey: sidebarKey(room),
                                }),
                            },
                          ],
                        },
                        {
                          label: activity?.[room.roomId]
                            ? "标记已读"
                            : "标记未读",
                          disabled: !activity,
                          run: () => void mark(room),
                        },
                        {
                          label: prefs!.pinned.includes(sidebarKey(room))
                            ? "取消置顶"
                            : "置顶",
                          run: () =>
                            patch(
                              prefs!.pinned.includes(sidebarKey(room))
                                ? {
                                    pinned: prefs!.pinned.filter(
                                      (k) => k !== sidebarKey(room),
                                    ),
                                  }
                                : moveSidebarItem(prefs!, room, "pinned"),
                            ),
                        },
                        ...(room.instancePrivateBox
                          ? [
                              {
                                label: "关闭会话",
                                disabled: hasUnresolvedIntents(),
                                run: () => closePrivate(room),
                              },
                            ]
                          : [
                              {
                                label: prefs!.mutedActivity.includes(
                                  sidebarKey(room),
                                )
                                  ? "取消静音"
                                  : "静音",
                                run: () =>
                                  patch({
                                    mutedActivity:
                                      prefs!.mutedActivity.includes(
                                        sidebarKey(room),
                                      )
                                        ? prefs!.mutedActivity.filter(
                                            (k) => k !== sidebarKey(room),
                                          )
                                        : [
                                            ...prefs!.mutedActivity,
                                            sidebarKey(room),
                                          ],
                                  }),
                              },
                              ...(room.slug === "all"
                                ? []
                                : [
                                    {
                                      label: "归档",
                                      run: () => {
                                        setError("");
                                        setArchiveTarget(room);
                                      },
                                    },
                                  ]),
                            ]),
                      ]}
                    >
                      {room.instancePrivateBox ? (
                        <PrivateBoxRow
                          roomId={room.roomId}
                          name={room.name}
                          description={
                            group.id === "pinned" ? undefined : room.description
                          }
                          selected={selected === room.roomId}
                          menuOpen={menuRoom === room.roomId}
                          unread={activity?.[room.roomId] ?? 0}
                          allowWrap={group.id === "pinned"}
                          onSelect={() => {
                            if (
                              onSelect(room.roomId) &&
                              activity?.[room.roomId]
                            )
                              void mark(room, "read");
                          }}
                        />
                      ) : (
                        <Row
                          channelId={room.roomId}
                          name={room.name}
                          selected={selected === room.roomId}
                          menuOpen={menuRoom === room.roomId}
                          unread={activity?.[room.roomId] ?? 0}
                          muted={prefs!.mutedActivity.includes(
                            sidebarKey(room),
                          )}
                          onSelectChannel={(id) => {
                            if (onSelect(id) && activity?.[id])
                              void mark(room, "read");
                          }}
                        />
                      )}
                    </SidebarContextMenu>
                  </DragRow>
                ))}
              {!collapsed.includes(group.id) &&
                !group.rooms.length &&
                group.id !== "dms" && (
                  <p className="px-2 text-xs text-foreground-muted">暂无频道</p>
                )}
            </DragSection>
          ))}
        </SidebarDrag>
      </SidebarContextMenu>
      {archiveTarget && (
        <ChannelArchiveDialog
          target={archiveTarget}
          archivedRooms={archivedRooms}
          manager={manager}
          error={error}
          busy={busy}
          onClose={() => setArchiveTarget(undefined)}
          onChange={archive}
          onOpen={onSelect}
        />
      )}
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
                删除“{title}”分组？会话和历史保留，移回各自默认列表。
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
                    ...(edit.moveKey
                      ? {
                          pinned: prefs!.pinned.filter(
                            (k) => k !== edit.moveKey,
                          ),
                        }
                      : {}),
                    customSections: edit.id
                      ? prefs!.customSections.map((s) =>
                          s.id === edit.id ? { ...s, name: title.trim() } : s,
                        )
                      : [
                          ...prefs!.customSections.map((s) =>
                            edit.moveKey
                              ? {
                                  ...s,
                                  items: s.items.filter(
                                    (k) => k !== edit.moveKey,
                                  ),
                                }
                              : s,
                          ),
                          {
                            id: crypto.randomUUID(),
                            name: title.trim(),
                            items: edit.moveKey ? [edit.moveKey] : [],
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
