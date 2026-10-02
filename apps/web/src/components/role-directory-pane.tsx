import { RoleRevisionEditor } from "./role-revision-editor.tsx";
import { RuntimePicker } from "./runtime-picker.tsx";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  LocalRuntimeInventoryEntry,
  RoleListResponse,
  Room,
} from "@rah-os/protocol";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { ChoiceRow } from "@rah-os/ui-web/neo-brutalist/choice-row";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import {
  DirectoryWidthLayout,
  DirectoryWidthResizer,
} from "./directory-width-layout.tsx";
import { RoleWrite } from "../role-write.ts";

export function RoleDirectoryPane({
  client,
  write,
  revisionWrite,
  runtimes,
  onRefreshModels,
  controlRoomId,
  rooms,
  revision,
  canCreate,
  onCreate,
  onOpenRoom,
  readHead,
  onInstantiated,
}: {
  client: RahClient;
  write: RoleWrite;
  revisionWrite: RoleWrite;
  runtimes: readonly LocalRuntimeInventoryEntry[];
  onRefreshModels: (offerId: string) => Promise<void>;
  controlRoomId: string | undefined;
  rooms: readonly Room[];
  revision: number;
  canCreate: boolean;
  onCreate: () => void;
  onOpenRoom: (roomId: string) => void;
  readHead: (roomId: string) => Promise<number>;
  onInstantiated: () => void;
}) {
  const [catalog, setCatalog] = useState<RoleListResponse>();
  const [selected, setSelected] = useState<string>();
  const [channelId, setChannelId] = useState("");
  const [error, setError] = useState<string>();
  const phase = useSyncExternalStore(write.subscribe, () => write.state);
  const pending = phase === "pending";
  const unknown = phase === "unknown";
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (phase !== "unknown") return;
    const saved = write.payload;
    if (typeof saved?.roleId === "string") setSelected(saved.roleId);
    if (typeof saved?.channelId === "string") setChannelId(saved.channelId);
  }, [phase, write]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setCatalog(undefined);
    if (!controlRoomId) return;
    void client.request("role.list", { controlRoomId }).then(
      (result) => {
        if (live) {
          setCatalog(result);
          setError(undefined);
        }
      },
      (error) => {
        if (live) setError(String(error));
      },
    );
    return () => {
      live = false;
    };
  }, [client, controlRoomId, revision, refresh]);
  const role = catalog?.roles.find((item) => item.roleId === selected);
  const channels = rooms.filter(
    (room) => room.kind === "channel" && !room.archivedAt,
  );
  async function instantiate() {
    if (!role || !channelId || pending) return;
    setError(undefined);
    try {
      const result = await write.run(
        { roleId: role.roleId, channelId },
        () => readHead(channelId),
        (request) => client.request("role.instantiate", request),
      );
      onInstantiated();
      if (mounted.current) onOpenRoom(result.instance.channelId);
    } catch (error) {
      setError(String(error));
    }
  }
  return (
    <DirectoryWidthLayout
      kind="agents"
      className={`channel rah-agent-runtime-page rah-agent-directory-page${selected ? " is-mobile-detail-open" : ""}`}
    >
      <section className="rah-agent-directory-body">
        <aside className="rah-agent-directory-list" aria-label="Role 列表">
          <PanelHeader kind="sidebar" className="rah-agent-sidebar-head">
            <h1>Role 管理</h1>
          </PanelHeader>
          <div className="rah-agent-sidebar-scroll rah-scroll-main">
            <button
              className="btn btn-pink"
              disabled={!canCreate || pending || unknown}
              onClick={onCreate}
            >
              创建 Role
            </button>
            {!catalog && !error && <p role="status">正在读取 Role…</p>}
            {catalog?.roles.length === 0 && (
              <p>尚无 Role。先保存配置，再在频道创建实例。</p>
            )}
            {catalog?.roles.map((item) => (
              <ChoiceRow
                key={item.roleId}
                profile="property-option"
                current={item.roleId === selected}
                className="rah-role-choice"
                disabled={pending || unknown}
                onClick={() => setSelected(item.roleId)}
              >
                {item.configuration.displayName}
              </ChoiceRow>
            ))}
            <button
              className="btn"
              disabled={pending || unknown}
              onClick={() => setRefresh((value) => value + 1)}
            >
              刷新列表
            </button>
          </div>
        </aside>
        <DirectoryWidthResizer />
        <section className="rah-agent-detail-panel">
          <PanelHeader kind="surface">
            {selected && (
              <button
                className="sq-btn rah-mobile-only"
                aria-label="返回 Role 列表"
                disabled={pending || unknown}
                onClick={() => setSelected(undefined)}
              >
                <Icon name="arrow-left" />
              </button>
            )}
            <h2>{role?.configuration.displayName ?? "Role"}</h2>
          </PanelHeader>
          <section className="rah-agent-profile-pane rah-scroll-main rah-role-profile">
            {error && <p role="alert">{error}</p>}
            {canCreate && (
              <RoleRevisionEditor
                role={role}
                write={revisionWrite}
                client={client}
                runtimes={runtimes}
                readHead={readHead}
                onRefreshModels={onRefreshModels}
                onSaved={() => setRefresh((value) => value + 1)}
              />
            )}
            {unknown && (
              <div role="status">
                <p>
                  创建结果未知。核实会重发同一请求，不会更换身份；请勿重新创建。
                </p>
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => void instantiate()}
                >
                  核实创建结果
                </button>
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "放弃核实不会撤销可能已创建的实例。请先检查频道成员，再决定是否另建。",
                      )
                    ) {
                      write.discard();
                      setError(undefined);
                      setRefresh((value) => value + 1);
                    }
                  }}
                >
                  放弃核实
                </button>
              </div>
            )}
            {!role ? (
              <p>选择一个 Role，查看配置与参与频道。</p>
            ) : (
              <>
                <p>Role 是可复用配置；每次加入频道都会创建独立实例和会话。</p>
                <dl>
                  <dt>职责</dt>
                  <dd>{role.configuration.role}</dd>
                  <dt>模型</dt>
                  <dd>
                    {role.configuration.modelIntent?.exactBindingIds?.join(
                      ", ",
                    ) ?? "未指定"}
                  </dd>
                  <dt>推理强度</dt>
                  <dd>{role.configuration.modelIntent?.reasoning ?? "默认"}</dd>
                  <dt>指令</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>
                    {role.configuration.instructions}
                  </dd>
                </dl>
                <RuntimePicker
                  label="加入频道"
                  value={channelId}
                  disabled={pending || unknown || !canCreate}
                  options={channels.map((room) => ({
                    id: room.roomId,
                    label: room.name,
                  }))}
                  onChange={setChannelId}
                />
                <button
                  className="btn btn-pink"
                  disabled={!canCreate || !channelId || pending || unknown}
                  onClick={() => void instantiate()}
                >
                  {pending ? "正在创建…" : "创建实例并打开频道"}
                </button>
                <h3>参与频道</h3>
                {catalog?.instances
                  .filter((instance) => instance.roleId === role.roleId)
                  .map((instance) => (
                    <div key={instance.instanceId}>
                      <button
                        className="btn"
                        disabled={pending || unknown}
                        onClick={() => onOpenRoom(instance.channelId)}
                      >
                        {rooms.find(
                          (room) => room.roomId === instance.channelId,
                        )?.name ?? "频道"}
                      </button>
                      <p>
                        {instance.isCurrent ? "当前配置" : "使用旧版本配置"} ·
                        session 压缩：
                        {instance.sessionCompactionCount ?? "未知"}
                      </p>
                      <small>{instance.instanceId}</small>
                    </div>
                  ))}
              </>
            )}
          </section>
        </section>
      </section>
    </DirectoryWidthLayout>
  );
}
