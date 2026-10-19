import { useRolePresence } from "./RolePresence.tsx";
import { rolePresence } from "./role-presence.ts";
import { uiActionProps } from "./ui-action-props.ts";
import { flushSync } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { Button, Spinner, AppShellMainSlot } from "raft-ui";
import RoleWorkspace, { type RoleEntry } from "./RoleWorkspace.tsx";
import type { RahClient } from "@rah-os/client-sdk";
import type { RoleTemplate } from "@rah-os/protocol";
import type { IntentOutcome } from "@rah-os/client-core/write-intent";
import {
  ChannelMemberListShell,
  ChannelMemberRow,
} from "../packages/web/src/components/channel/ChannelMemberList.tsx";
import {
  ManagementClient,
  type Catalog,
  type Instance,
} from "./management-client.ts";
import {
  ActionDialog,
  ActionMenu,
  SelectField,
  useManagement,
  OperationStatus,
} from "./ManagementUi.tsx";
import RuntimeControl from "./RuntimeControl.tsx";
import DiscardChangesDialog from "./DiscardChangesDialog.tsx";
import { useIntentRoute } from "./useIntentRoute.ts";
import RoleEditor from "./RoleEditor.tsx";
type Edit =
  | { kind: "create" }
  | { kind: "edit"; role: RoleTemplate }
  | { kind: "delete"; role: RoleTemplate }
  | { kind: "add"; role: RoleTemplate }
  | { kind: "restart"; instance: Instance; name: string }
  | { kind: "remove"; instance: Instance; name: string };
export default function AgentPage({
  client,
  workspaceId,
  controlRoomId,
  active,
  onOpenChannel,
  onOpenPrivate,
  notice,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  active: boolean;
  notice: ReactNode;
  onOpenChannel: (id: string) => void;
  onOpenPrivate: (id: string) => void;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const { state, error, setError } = useManagement(manager);
  const [catalog, setCatalog] = useState<Catalog>();
  const [tab, setTab] = useState("roles");
  const [params, setParams] = useIntentRoute();
  const selectedId = params.get("role") ?? undefined;
  // Returning to a root tab hides detail without destroying its draft.
  const lastSelectedId = useRef(selectedId);
  if (selectedId) lastSelectedId.current = selectedId;
  const [dirty, setDirty] = useState(false);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [discard, setDiscard] = useState<() => void>();
  const [editorEpoch, setEditorEpoch] = useState(0);
  const guard = (action: () => void, changed = dirty) => {
    if (changed) setDiscard(() => action);
    else action();
  };
  const selectRole = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("role", id);
    else next.delete("role");
    setParams(next);
    setTab("roles");
  };
  const [edit, setEdit] = useState<Edit>();
  const [channel, setChannel] = useState("");
  const [revision, setRevision] = useState("keep");
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
      const next = await manager.catalog();
      if (ticket === request.current) setCatalog(next);
    } catch {
      if (ticket === request.current) {
        setCatalog(undefined);
        setError("暂时无法读取管理数据，请刷新。");
      }
    } finally {
      if (ticket === request.current) setRefreshing(false);
    }
  }, [manager, setError]);
  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);
  const open = (value: Edit) => {
    if (state !== "idle") return;
    setError("");
    setDialogDirty(false);
    setEdit(value);
    setChannel("");
    setRevision("keep");
  };
  const done = (outcome: IntentOutcome<unknown>) => {
    if (outcome.kind === "ok") {
      setEdit(undefined);
      setError("");
      void refresh();
    } else if (outcome.kind === "rejected") {
      setError(
        `操作被拒绝：${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`,
      );
      void refresh();
    }
  };
  const roleForInstance =
    edit && "instance" in edit
      ? catalog?.roles.find((r) => r.roleId === edit.instance.roleId)
      : undefined;
  const roleName = (role: RoleTemplate) => role.configuration.displayName;
  const busy = state !== "idle" || refreshing;
  const presence = useRolePresence(client, catalog?.instances ?? [], active);
  const entries: RoleEntry[] = (catalog?.roles ?? []).map((role) => ({
    id: role.roleId,
    name: roleName(role),
    presence: rolePresence(
      (catalog?.instances ?? [])
        .filter((i) => i.roleId === role.roleId)
        .map((i) => i.instanceId),
      presence,
    ),
  }));
  // Deleting a Role never deletes its frozen instances. Keep a read-only group
  // for these instances; do not reconstruct a current Role from their snapshots.
  for (const instance of catalog?.instances ?? []) {
    if (entries.some((entry) => entry.id === instance.roleId)) continue;
    const agent = catalog?.agents.find(
      (a) => a.definition.agentId === instance.agentId,
    );
    entries.push({
      id: instance.roleId,
      name: `已删除角色（${agent?.currentRevision.displayName ?? "保留实例"}）`,
      retired: true,
    });
  }
  const selected =
    entries.find(
      (entry) => entry.id === (selectedId ?? lastSelectedId.current),
    ) ?? entries[0];
  const role = catalog?.roles.find((role) => role.roleId === selected?.id);
  const instances =
    catalog?.instances.filter((instance) => instance.roleId === selected?.id) ??
    [];

  return (
    <AppShellMainSlot
      className={active ? "bg-layer-canvas " : "hidden"}
      data-testid="loom-agent-page"
    >
      {notice}
      <RoleWorkspace
        entries={entries}
        selected={selected}
        detail={Boolean(selectedId)}
        onBack={() => guard(() => selectRole())}
        onSelect={(id) =>
          guard(() => selectRole(id), dirty && id !== selected?.id)
        }
        tab={tab}
        onTab={setTab}
        busy={busy}
        onCreate={() => guard(() => open({ kind: "create" }))}
        onRefresh={() => void refresh()}
        actions={
          role && (
            <ActionMenu
              label={`更多操作 ${roleName(role)}`}
              disabled={busy}
              items={[
                {
                  label: "添加实例到频道",
                  run: () => open({ kind: "add", role }),
                },
                {
                  label: "删除角色",
                  run: () => open({ kind: "delete", role }),
                },
              ]}
            />
          )
        }
      >
        {!edit && <OperationStatus manager={manager} error={error} />}
        {!catalog ? (
          !error && <Spinner aria-label="读取角色和实例" />
        ) : (
          <>
            <div hidden={tab !== "roles"}>
              {role ? (
                <RoleEditor
                  key={`${role.roleRevisionId}:${editorEpoch}`}
                  client={client}
                  role={role}
                  onDirtyChange={setDirty}
                  disabled={busy}
                  onSave={(configuration) =>
                    void manager.save(configuration, role, done)
                  }
                />
              ) : selected?.retired ? (
                <p>角色定义已删除。已有实例保留原配置，可在实例标签页管理。</p>
              ) : (
                <p>从左侧选择或创建角色。</p>
              )}
            </div>
            <div hidden={tab !== "instances"}>
              {!instances.length ? (
                <p>此角色暂无实例</p>
              ) : (
                <ChannelMemberListShell framed={false}>
                  {instances.map((instance) => {
                    const agent = catalog.agents.find(
                      (a) => a.definition.agentId === instance.agentId,
                    );
                    const name =
                      agent?.currentRevision.displayName ??
                      agent?.handle ??
                      "实例";
                    const room = catalog.rooms.find(
                      (r) => r.roomId === instance.channelId,
                    );
                    return (
                      <ChannelMemberRow
                        key={instance.instanceId}
                        type="agent"
                        name={name}
                        secondary={`${room?.name ?? "频道不可用"} · ${instance.isCurrent ? "配置为当前修订" : "保留旧配置"}`}
                        trailing={
                          <RuntimeControl
                            client={client}
                            controlRoomId={controlRoomId}
                            workspaceId={workspaceId}
                            agentId={instance.agentId}
                            branchSource={instance}
                            onBranched={() => void refresh()}
                            name={name}
                            active={active && tab === "instances"}
                            disabled={busy}
                            items={[
                              {
                                label: "打开频道",
                                run: () => onOpenChannel(instance.channelId),
                              },
                              {
                                label: "打开私聊",
                                run: () => onOpenPrivate(instance.instanceId),
                              },
                              {
                                label: "重启实例",
                                run: () =>
                                  open({ kind: "restart", instance, name }),
                              },
                              {
                                label: "移除实例",
                                run: () =>
                                  open({ kind: "remove", instance, name }),
                              },
                            ]}
                          />
                        }
                      />
                    );
                  })}
                </ChannelMemberListShell>
              )}
            </div>
          </>
        )}
      </RoleWorkspace>
      {edit && (
        <ActionDialog
          title={
            edit.kind === "create"
              ? "新建角色"
              : edit.kind === "edit"
                ? "编辑角色"
                : edit.kind === "delete"
                  ? "删除角色"
                  : edit.kind === "add"
                    ? "添加实例到频道"
                    : edit.kind === "restart"
                      ? "重启实例"
                      : "移除实例"
          }
          manager={manager}
          error={error}
          onClose={() => guard(() => setEdit(undefined), dialogDirty)}
        >
          {edit.kind === "create" || edit.kind === "edit" ? (
            <RoleEditor
              client={client}
              onDirtyChange={setDialogDirty}
              onNavigationDiscard={() => setEdit(undefined)}
              {...(edit.kind === "edit" ? { role: edit.role } : {})}
              disabled={busy}
              onSave={(configuration) =>
                void manager.save(
                  configuration,
                  edit.kind === "edit" ? edit.role : undefined,
                  done,
                )
              }
            />
          ) : edit.kind === "delete" ? (
            <>
              <p className="mb-4">
                删除“{roleName(edit.role)}
                ”的角色定义？已有实例、配置快照与历史保留。以后重建同名角色属于新身份。
              </p>
              <Button
                {...uiActionProps.confirmDelete}
                disabled={busy}
                onClick={() => void manager.deleteRole(edit.role, done)}
              >
                确认删除角色
              </Button>
            </>
          ) : edit.kind === "add" ? (
            <>
              <SelectField
                label="频道"
                value={channel}
                disabled={busy}
                onChange={setChannel}
                options={(catalog?.rooms ?? [])
                  .filter((r) => r.kind === "channel" && !r.archivedAt)
                  .map((r) => ({ value: r.roomId, label: r.name }))}
              />
              <Button
                {...uiActionProps.dialogSave}
                disabled={busy || !channel}
                onClick={() =>
                  void manager.instance("add", channel, edit.role.roleId, done)
                }
              >
                确认添加
              </Button>
            </>
          ) : edit.kind === "remove" ? (
            <>
              <p className="mb-4">
                移除“{edit.name}
                ”？停止后续投递，保留历史；若有未结束工作，服务端会拒绝。重新添加会创建新实例。
              </p>
              <Button
                {...uiActionProps.confirmDelete}
                disabled={busy}
                onClick={() =>
                  void manager.instance(
                    "remove",
                    edit.instance.channelId,
                    edit.instance.instanceId,
                    done,
                  )
                }
              >
                确认移除
              </Button>
            </>
          ) : (
            <>
              <p className="mb-4 text-sm">
                下一次运行将启动新的原生会话。近期对话按窗口补入，更早历史按需读取；频道历史与记忆保留。有运行中工作时无法重启。
              </p>
              <SelectField
                label="重启配置"
                value={revision}
                disabled={busy}
                onChange={setRevision}
                options={[
                  { value: "keep", label: "保留现有名称和配置" },
                  ...(roleForInstance
                    ? [
                        {
                          value: roleForInstance.roleRevisionId,
                          label: `采用 ${roleForInstance.configuration.displayName} 最新配置（名称、Prompt、CLI、模型）`,
                        },
                      ]
                    : []),
                ]}
              />
              <Button
                {...uiActionProps.confirmChange}
                disabled={busy || !revision}
                onClick={() =>
                  void manager.instance(
                    "restart",
                    edit.instance.channelId,
                    edit.instance.instanceId,
                    done,
                    revision === "keep" ? undefined : revision,
                  )
                }
              >
                确认重启
              </Button>
            </>
          )}
        </ActionDialog>
      )}
      {discard && (
        <DiscardChangesDialog
          onCancel={() => setDiscard(undefined)}
          onDiscard={() => {
            const action = discard;
            flushSync(() => {
              setDiscard(undefined);
              setDirty(false);
              setDialogDirty(false);
              setEditorEpoch((v) => v + 1);
            });
            action();
          }}
        />
      )}
    </AppShellMainSlot>
  );
}
