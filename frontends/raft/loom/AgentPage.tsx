import PageEmpty from "./PageEmpty";
import { roleComputer } from "./role-computer-groups";
import type { LocalRuntimeInventoryResponse } from "@rah-os/protocol";
import InstanceListRow from "./InstanceListRow.tsx";
import InstancePresence, { useInstancePresence } from "./InstancePresence.tsx";
import RoleBatchDialog, { type RoleBatchAction } from "./RoleBatchDialog.tsx";
import { OfficialRoleAction } from "./OfficialRoleControls.generated";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog.tsx";
import RoleActivity from "./RoleActivity.tsx";
import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";
import RoleProfile from "./RoleProfile.tsx";
import InstanceInspector from "./InstanceInspector.tsx";
import StandaloneChatDialog from "./StandaloneChatDialog.tsx";
import {
  MessageSquare,
  Plus,
  Square,
  Play,
  RotateCcw,
  Trash2,
  LogIn,
  UserMinus,
} from "lucide-react";
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
import { Button, Spinner, Separator } from "raft-ui";
import RoleWorkspace, { type RoleEntry } from "./RoleWorkspace.tsx";
import type { RahClient } from "@rah-os/client-sdk";
import type { RoleTemplate } from "@rah-os/protocol";
import type { IntentOutcome } from "@rah-os/client-core/write-intent";
import { OfficialListRowGroup } from "./OfficialListRows.tsx";
import SectionHeader from "../packages/web/src/components/ui/SectionHeader.tsx";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import { rolePresentation } from "./role-profile-values";
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
import RestoreRoleDialog from "./RestoreRoleDialog.tsx";
import CreateRoleDialog from "./CreateRoleDialog.tsx";
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
  onStandaloneCreated,
  notice,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  active: boolean;
  notice: ReactNode;
  onOpenChannel: (id: string) => void;
  onStandaloneCreated: (id: string) => Promise<void>;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const { state, error, setError } = useManagement(manager);
  const [catalog, setCatalog] = useState<Catalog>();
  const [inventory, setInventory] = useState<LocalRuntimeInventoryResponse>();
  const [tab, setTab] = useState("roles");
  const [params, setParams] = useIntentRoute();
  const selectedId = params.get("role") ?? undefined;
  // Returning to a root tab hides detail without destroying its draft.
  const lastSelectedId = useRef(selectedId);
  if (selectedId) lastSelectedId.current = selectedId;
  const [dirty, setDirty] = useState(false);
  const [inspecting, setInspecting] = useState<string>();
  const instanceTrigger = useRef<HTMLElement | null>(null);
  const closeInspector = useCallback(() => {
    setInspecting(undefined);
    requestAnimationFrame(
      () =>
        instanceTrigger.current?.isConnected && instanceTrigger.current.focus(),
    );
  }, []);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [discard, setDiscard] = useState<() => void>();
  const [editorEpoch, setEditorEpoch] = useState(0);
  const guard = (action: () => void, changed = dirty) => {
    if (changed) setDiscard(() => action);
    else action();
  };
  const selectRole = (id?: string) => {
    setInspecting(undefined);
    const next = new URLSearchParams(params);
    if (id) next.set("role", id);
    else next.delete("role");
    setParams(next);
    setTab("roles");
  };
  const [restoring, setRestoring] = useState<RoleTemplate>();
  const [standalone, setStandalone] = useState<RoleTemplate>();
  const [edit, setEdit] = useState<Edit>();
  const [batch, setBatch] = useState<{
    action: RoleBatchAction;
    role: RoleTemplate;
    instances: (Instance & { name: string })[];
  }>();
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
      // Group headings may arrive later than Roles. Native discovery must not block the list.
      void client
        .request("host.runtime.list", {})
        .then((computer) => {
          if (ticket === request.current) setInventory(computer);
        })
        .catch(() => {
          if (ticket === request.current) setInventory(undefined);
        });
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
  }, [manager, setError, client]);
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
      setDirty(false);
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
  const instancePresences = useInstancePresence(client, controlRoomId, active);
  const presence = useRolePresence(client, catalog?.instances ?? [], active);
  const entries: RoleEntry[] = [
    ...(catalog?.roles ?? []),
    ...(catalog?.deletedRoles ?? []),
  ].map((role) => ({
    retired:
      catalog?.deletedRoles?.some((r) => r.roleId === role.roleId) ?? false,
    id: role.roleId,
    name: roleName(role),
    computer: roleComputer(role.configuration.runtimeOfferId, inventory),
    avatarUrl: role.configuration.avatarKey,
    ...rolePresentation(role.configuration, inventory),
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
    ) ?? entries.find((entry) => !entry.retired);
  const role = catalog?.roles.find((role) => role.roleId === selected?.id);
  const deletedRole = catalog?.deletedRoles?.find(
    (r) => r.roleId === selected?.id,
  );
  const instances =
    catalog?.instances.filter((instance) => instance.roleId === selected?.id) ??
    [];

  const roleActions = role
    ? [
        {
          label: "添加实例到频道",
          icon: <Plus size={14} />,
          run: () => guard(() => open({ kind: "add", role })),
        },
        {
          label: "停止所有实例",
          icon: <Square size={14} />,
          run: () => startBatch("stop"),
          disabled: !instances.length,
        },
        {
          label: "启用所有实例",
          icon: <Play size={14} />,
          run: () => startBatch("enable"),
          disabled: !instances.length,
        },
        {
          label: "重启／重置所有实例",
          icon: <RotateCcw size={14} />,
          run: () => startBatch("restart"),
          disabled: !instances.length,
        },
        {
          label: "删除角色",
          icon: <Trash2 size={14} />,
          danger: true,
          run: () => guard(() => open({ kind: "delete", role })),
        },
      ]
    : [];
  function startBatch(action: RoleBatchAction) {
    if (!role || busy) return;
    guard(() =>
      setBatch({
        action,
        role,
        instances: instances.map((i) => ({
          ...i,
          name:
            catalog?.agents.find((a) => a.definition.agentId === i.agentId)
              ?.currentRevision.displayName ?? "实例",
        })),
      }),
    );
  }
  return (
    <div
      className={
        active
          ? "relative flex min-h-0 min-w-0 flex-1 flex-col bg-layer-canvas"
          : "hidden"
      }
      data-testid="loom-agent-page"
    >
      {notice}
      {restoring && (
        <RestoreRoleDialog
          client={client}
          workspaceId={workspaceId}
          controlRoomId={controlRoomId}
          role={restoring}
          onClose={() => setRestoring(undefined)}
          onRestored={() => {
            setRestoring(undefined);
            void refresh();
          }}
        />
      )}
      {standalone && (
        <StandaloneChatDialog
          client={client}
          workspaceId={workspaceId}
          controlRoomId={controlRoomId}
          role={standalone}
          onClose={() => setStandalone(undefined)}
          onCreated={async (id) => {
            await onStandaloneCreated(id);
            setStandalone(undefined);
            void refresh();
          }}
        />
      )}
      <RoleWorkspace
        workspaceId={workspaceId}
        inspector={(() => {
          const i = instances.find((i) => i.instanceId === inspecting);
          const a = catalog?.agents.find(
            (a) => a.definition.agentId === i?.agentId,
          );
          const r = catalog?.rooms.find((r) => r.roomId === i?.channelId);
          return active && selectedId && i && a && r ? (
            <InstanceInspector
              key={i.instanceId}
              client={client}
              controlRoomId={controlRoomId}
              room={r}
              member={{
                principalId: i.instanceId,
                kind: "agent",
                handle: a.handle,
                displayName: a.currentRevision.displayName,
              }}
              backLabel="返回实例列表"
              onClose={closeInspector}
              controlItems={[
                {
                  label: "打开频道",
                  icon: <LogIn size={14} />,
                  run: () => onOpenChannel(i.channelId),
                },
                {
                  label: "重启实例",
                  inline: true,
                  icon: <RotateCcw size={14} />,
                  run: () =>
                    open({
                      kind: "restart",
                      instance: i,
                      name: a.currentRevision.displayName ?? a.handle,
                    }),
                },
              ]}
            />
          ) : null;
        })()}
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
            <>
              <Button
                {...uiActionProps.menuIcon}
                aria-label="开始独立单聊"
                disabled={busy}
                onClick={() => guard(() => setStandalone(role))}
              >
                <MessageSquare size={20} />
              </Button>
              <ActionMenu
                label={`更多操作 ${roleName(role)}`}
                disabled={busy}
                items={roleActions}
              />
            </>
          )
        }
      >
        {!edit && <OperationStatus manager={manager} error={error} />}
        {!catalog ? (
          !error && <Spinner aria-label="读取角色和实例" />
        ) : !selected ? (
          <PageEmpty kind="roles" />
        ) : (
          <>
            {selected && (
              <div hidden={tab !== "activity"}>
                <RoleActivity
                  key={selected.id}
                  client={client}
                  active={active && Boolean(selectedId) && tab === "activity"}
                  sources={instances.flatMap((instance) => {
                    const agent = catalog.agents.find(
                      (a) => a.definition.agentId === instance.agentId,
                    );
                    return agent
                      ? [
                          {
                            agentId: instance.agentId,
                            instanceId: agent.definition.participantId,
                            roomId: instance.channelId,
                            name:
                              agent.currentRevision.displayName ?? agent.handle,
                          },
                        ]
                      : [];
                  })}
                />
              </div>
            )}
            <div hidden={tab !== "roles"}>
              {role ? (
                <>
                  <RoleProfile
                    key={`${role.roleRevisionId}:${editorEpoch}`}
                    client={client}
                    role={role}
                    disabled={busy}
                    onDirtyChange={setDirty}
                    onSave={(configuration, avatarUploadIntentId) =>
                      void manager.save(
                        configuration,
                        role,
                        done,
                        avatarUploadIntentId,
                      )
                    }
                  />
                </>
              ) : selected?.retired ? (
                <div className="px-5 py-4 space-y-3">
                  <p className="text-callout">
                    角色定义已删除。已有实例保留原配置和运行状态，可在下方管理。
                  </p>
                  {deletedRole && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRestoring(deletedRole)}
                    >
                      <RotateCcw size={16} />
                      恢复角色
                    </Button>
                  )}
                </div>
              ) : (
                <PageEmpty kind="roles" />
              )}
              <Separator />
              <section
                className="px-5 py-4"
                data-testid="role-profile-instances"
              >
                <SectionHeader
                  label="实例"
                  count={instances.length}
                  className="mb-3"
                  action={
                    role && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => guard(() => open({ kind: "add", role }))}
                        aria-label="新建实例"
                      >
                        <Plus size={16} />
                        实例
                      </Button>
                    )
                  }
                />
                {!instances.length ? (
                  <div className="text-footnote text-foreground-hint">
                    此角色还没有实例
                  </div>
                ) : (
                  <OfficialListRowGroup>
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
                        <InstanceListRow
                          key={instance.instanceId}
                          avatar={
                            <AvatarSlot
                              context="list-row"
                              type="agent"
                              agentAvatarUrl={agent?.currentRevision.avatarKey}
                            />
                          }
                          name={name}
                          onClick={
                            room
                              ? () =>
                                  guard(() => {
                                    instanceTrigger.current =
                                      document.activeElement as HTMLElement;
                                    setInspecting(instance.instanceId);
                                  })
                              : undefined
                          }
                          subtitle={`${room?.name ?? "频道不可用"} · ${instance.isCurrent ? "配置为当前修订" : "保留旧配置"}`}
                          status={
                            <InstancePresence
                              activity={
                                agent?.definition.state === "disabled"
                                  ? "offline"
                                  : instancePresences.find(
                                      (p) => p.agentId === instance.agentId,
                                    )?.activity
                              }
                            />
                          }
                          actions={
                            <RuntimeControl
                              client={client}
                              controlRoomId={controlRoomId}
                              workspaceId={workspaceId}
                              agentId={instance.agentId}
                              branchSource={instance}
                              onBranched={() => void refresh()}
                              name={name}
                              active={active && tab === "roles"}
                              disabled={busy}
                              items={[
                                {
                                  label: "打开频道",
                                  icon: <LogIn size={14} />,
                                  run: () => onOpenChannel(instance.channelId),
                                },
                                {
                                  label: "重启实例",
                                  icon: <RotateCcw size={14} />,
                                  run: () =>
                                    open({ kind: "restart", instance, name }),
                                },
                                {
                                  label: "移除实例",
                                  icon: <UserMinus size={14} />,
                                  run: () =>
                                    open({ kind: "remove", instance, name }),
                                },
                              ]}
                            />
                          }
                        />
                      );
                    })}
                  </OfficialListRowGroup>
                )}
              </section>
              {role && (
                <>
                  <Separator />
                  <section
                    className="px-5 py-4"
                    data-testid="role-profile-actions"
                  >
                    <SectionEyebrow as="div" className="mb-3">
                      操作
                    </SectionEyebrow>
                    <div className="space-y-2">
                      {roleActions.map((item) => (
                        <OfficialRoleAction
                          key={item.label}
                          onClick={item.run}
                          disabled={busy || item.disabled}
                          danger={item.danger}
                        >
                          {item.icon}
                          {item.label}
                        </OfficialRoleAction>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </RoleWorkspace>
      {batch && (
        <RoleBatchDialog
          client={client}
          workspaceId={workspaceId}
          controlRoomId={controlRoomId}
          {...batch}
          onClose={() => setBatch(undefined)}
          onChanged={() => void refresh()}
        />
      )}
      {edit?.kind === "delete" && (
        <ConfirmDialog
          title="删除角色"
          confirmLabel="确认删除角色"
          confirmVariant="danger"
          closeOnConfirm={false}
          confirmDisabled={busy}
          onClose={() => {
            if (!busy) setEdit(undefined);
          }}
          message={
            <>
              <p>
                删除“{roleName(edit.role)}
                ”的角色定义？运行中的实例不会停止，仍可继续收发消息；已有会话、配置快照与历史保留。删除后不能再用该角色新增实例。以后重建同名角色属于新身份。
              </p>
              <OperationStatus manager={manager} error={error} />
            </>
          }
          onConfirm={() => manager.deleteRole(edit.role, done).then(() => {})}
        />
      )}
      {edit?.kind === "create" && (
        <CreateRoleDialog
          client={client}
          workspaceId={workspaceId}
          controlRoomId={controlRoomId}
          onClose={() => setEdit(undefined)}
          onChanged={() => void refresh()}
        />
      )}
      {edit && edit.kind !== "delete" && edit.kind !== "create" && (
        <ActionDialog
          sheet={edit.kind === "edit"}
          title={
            edit.kind === "edit"
              ? "编辑角色"
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
          {edit.kind === "edit" ? (
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
    </div>
  );
}
