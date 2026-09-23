import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { runRoomMutationAtLatest, type RoomSession } from "@rah-os/client-core";
import type {
  LocalRuntimeInventoryEntry,
  RoleTemplate,
  RoleListResponse,
  Room,
} from "@rah-os/protocol";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";
import { LoadingState } from "@rah-os/ui-web/neo-brutalist/loading-state";
import { AgentCreateDialog } from "./agent-dialogs.tsx";

/** MVP entry: versioned Role -> independent channel instance -> existing chat. */
export function RoleDirectoryPane({
  client,
  controlRoomId,
  rooms,
  runtimes,
  computerLabel,
  sessionFor,
  onBack,
  onJoined,
  onRefreshModels,
}: {
  client: RahClient;
  controlRoomId: string;
  rooms: readonly Room[];
  runtimes: readonly LocalRuntimeInventoryEntry[];
  computerLabel: string | undefined;
  sessionFor: (roomId: string) => RoomSession;
  onBack: () => void;
  onJoined: () => void;
  onRefreshModels: (offerId: string) => Promise<void>;
}) {
  const [roles, setRoles] = useState<RoleTemplate[]>();
  const [instances, setInstances] = useState<RoleListResponse["instances"]>([]);
  const [editing, setEditing] = useState<RoleTemplate>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setRoles(undefined);
    setError(undefined);
    client
      .request("role.list", { controlRoomId })
      .then((result) => {
        if (active) {
          setRoles(result.roles);
          setInstances(result.instances);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [client, controlRoomId, revision]);
  async function join(roleId: string) {
    if (lock.current || !channelId) return;
    lock.current = true;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    const idempotencyKey = crypto.randomUUID();
    try {
      await runRoomMutationAtLatest({
        session: sessionFor(channelId),
        mutate: (basedOnRoomSeq) =>
          client.request("role.instantiate", {
            roleId,
            channelId,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      });
      setNotice("实例已加入频道");
      onJoined();
      setRevision((value) => value + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <main
      className="channel rah-agent-runtime-page rah-role-page"
      aria-label="Role 管理"
    >
      <PanelHeader kind="surface">
        <button className="btn" onClick={onBack}>
          返回成员
        </button>
        <h2>Role 管理</h2>
        <button className="btn btn-pink" onClick={() => setCreating(true)}>
          创建 Role
        </button>
      </PanelHeader>
      <div className="rah-role-page-body">
        <ProfileSection title="加入频道">
          <label>
            实例所在频道
            <select
              className="input"
              aria-label="实例所在频道"
              value={channelId}
              disabled={pending}
              onChange={(e) => setChannelId(e.target.value)}
            >
              <option value="">请选择频道</option>
              {rooms
                .filter((room) => room.kind === "channel" && !room.archivedAt)
                .map((room) => (
                  <option key={room.roomId} value={room.roomId}>
                    #{room.name}
                  </option>
                ))}
            </select>
          </label>
        </ProfileSection>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {roles === undefined && !error ? <LoadingState /> : null}
        {roles?.length === 0 ? (
          <p>暂无 Role。创建配置后，可将它加入频道。</p>
        ) : null}
        {roles?.map((role) => (
          <ProfileSection
            key={role.roleId}
            title={role.configuration.displayName}
            action={
              <button
                className="btn"
                disabled={pending}
                onClick={() => setEditing(role)}
              >
                编辑 Role
              </button>
            }
          >
            <p>{role.configuration.description || role.configuration.role}</p>
            <button
              className="btn btn-yellow"
              disabled={pending || !channelId}
              onClick={() => void join(role.roleId)}
            >
              加入频道
            </button>
            <ul aria-label={`${role.configuration.displayName} 的频道实例`}>
              {instances
                .filter((instance) => instance.roleId === role.roleId)
                .map((instance) => (
                  <li key={instance.instanceId}>
                    #
                    {rooms.find((room) => room.roomId === instance.channelId)
                      ?.name ?? instance.channelId}
                    {" · "}
                    <span title={instance.instanceId}>
                      实例 {instance.instanceId.slice(-8)}
                    </span>
                    {" · "}
                    <strong>
                      {instance.isCurrent ? "当前版本" : "使用旧版本"}
                    </strong>
                  </li>
                ))}
            </ul>
          </ProfileSection>
        ))}
      </div>
      {(creating || editing) && (
        <AgentCreateDialog
          purpose="role"
          {...(editing ? { initialConfiguration: editing.configuration } : {})}
          client={client}
          computerLabel={computerLabel}
          runtimes={runtimes}
          onRefreshModels={onRefreshModels}
          onClose={() => {
            setCreating(false);
            setEditing(undefined);
          }}
          onCreate={async (configuration) => {
            const idempotencyKey = crypto.randomUUID();
            const result = await runRoomMutationAtLatest({
              session: sessionFor(controlRoomId),
              mutate: (basedOnRoomSeq) =>
                editing
                  ? client.request("role.revise", {
                      roleId: editing.roleId,
                      expectedRoleRevisionId: editing.roleRevisionId,
                      basedOnRoomSeq,
                      idempotencyKey,
                      configuration,
                    })
                  : client.request("role.create", {
                      controlRoomId,
                      basedOnRoomSeq,
                      idempotencyKey,
                      configuration,
                    }),
            });
            setRevision((value) => value + 1);
            return result.role.roleId;
          }}
        />
      )}
    </main>
  );
}
