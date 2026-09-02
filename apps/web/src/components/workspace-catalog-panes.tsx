import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

import type {
  LocalRuntimeInventoryEntry,
  LocalComputerObservation,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { computerStatusLabel } from "../attention-presentation.ts";

import {
  clampRoomSidebarWidth,
  nextRoomSidebarWidth,
  RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH,
  RAFT_ROOM_SIDEBAR_MAX_WIDTH,
  RAFT_ROOM_SIDEBAR_MIN_WIDTH,
} from "../room-sidebar-resize.ts";
import { Icon } from "./icon.tsx";

export function ComputerRuntimePane({
  hostId,
  inventoryError,
  runtimes,
  computer,
  agents = [],
}: {
  hostId: string | undefined;
  inventoryError: string | undefined;
  runtimes: readonly LocalRuntimeInventoryEntry[];
  computer?: LocalComputerObservation | undefined;
  agents?: readonly WorkspaceAgentView[];
}) {
  // Explicit local default. Raft also restores remembered selections; its root route may be empty.
  const [selected, setSelected] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(
    RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH,
  );
  const [resizing, setResizing] = useState(false);
  const resizeOrigin = useRef<{ clientX: number; width: number } | undefined>(
    undefined,
  );
  const computerName = computer?.displayName ?? displayComputerName(hostId);
  const statusLabel = computerStatusLabel(computer);
  const online = computer?.status === "online";
  const configuredRuntimes = runtimes.filter(
    ({ available, configured }) => available && configured,
  );
  const bindings = uniqueBindings(
    runtimes.filter((runtime) => runtime.configured),
  );
  const rootStyle = {
    "--rah-computer-sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  function onResizePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    resizeOrigin.current = { clientX: event.clientX, width: sidebarWidth };
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onResizePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const origin = resizeOrigin.current;
    if (origin === undefined) return;
    setSidebarWidth(
      clampRoomSidebarWidth(origin.width + event.clientX - origin.clientX),
    );
  }

  function onResizePointerEnd(event: PointerEvent<HTMLDivElement>): void {
    resizeOrigin.current = undefined;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const width = nextRoomSidebarWidth(sidebarWidth, event.key);
    if (width === undefined) return;
    event.preventDefault();
    setSidebarWidth(width);
  }

  return (
    <main className="rah-computer-directory" style={rootStyle}>
      <aside className="rah-computer-sidebar">
        <header>计算机</header>
        <div className="rah-computer-sidebar-body rah-scroll-main">
          <section>
            <div className="rah-computer-group-head">
              <Icon name="chevron" />
              <b>计算机</b>
              <span>{hostId === undefined ? 0 : 1}</span>
              <button
                aria-label="添加计算机"
                disabled
                title="远程 Computer 注册 API 尚未接入"
                type="button"
              >
                +
              </button>
            </div>
            {hostId === undefined ? null : (
              <button
                aria-current={selected ? "page" : undefined}
                className={`rah-computer-row rah-interaction-row${selected ? " is-selected" : ""}`}
                onClick={() => setSelected(true)}
                type="button"
              >
                <span className="rah-computer-row-icon">
                  <Icon name="monitor" />
                  <i
                    className={online ? "is-online" : ""}
                    title={statusLabel}
                    aria-label={statusLabel}
                  />
                </span>
                <span>
                  <b>{computerName}</b>
                  <small>Computer · {statusLabel}</small>
                </span>
              </button>
            )}
          </section>
        </div>
      </aside>
      <div
        aria-label="调整计算机边栏宽度"
        aria-orientation="vertical"
        aria-valuemax={RAFT_ROOM_SIDEBAR_MAX_WIDTH}
        aria-valuemin={RAFT_ROOM_SIDEBAR_MIN_WIDTH}
        aria-valuenow={sidebarWidth}
        className={`rah-computer-sidebar-resizer${resizing ? " is-dragging" : ""}`}
        onKeyDown={onResizeKeyDown}
        onPointerCancel={onResizePointerEnd}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerEnd}
        role="separator"
        tabIndex={0}
      />
      {hostId === undefined ? (
        <section className="rah-computer-empty">
          {inventoryError === undefined
            ? "当前没有已注册的 Computer"
            : `Computer 管理 API 不可用：${inventoryError}`}
        </section>
      ) : !selected ? (
        <section className="rah-computer-empty">选择一台计算机</section>
      ) : (
        <section className="rah-computer-detail">
          <header className="rah-computer-detail-head">
            <span>
              <Icon name="monitor" />
            </span>
            <h1>{computerName}</h1>
          </header>
          <div className="rah-computer-detail-scroll rah-scroll-main">
            <div className="rah-computer-hero">
              <span>
                <Icon name="monitor" />
              </span>
              <div>
                <h2>{computerName}</h2>
                <p>
                  <i className={online ? "is-online" : ""} />
                  {statusLabel}
                </p>
                <code>{computer?.hostname ?? hostId}</code>
                {inventoryError && (
                  <p role="status">观测暂不可用：{inventoryError}</p>
                )}
              </div>
            </div>
            <ComputerField label="名称">{computerName}</ComputerField>
            <ComputerField label="描述" muted>
              暂无描述
            </ComputerField>
            <section className="rah-computer-info">
              <h2>信息</h2>
              <dl>
                <div>
                  <dt>OS</dt>
                  <dd>{computer?.os ?? "—"}</dd>
                </div>
                <div>
                  <dt>Computer 版本</dt>
                  <dd>{computer?.buildVersion ?? "—"}</dd>
                </div>
                <div>
                  <dt>最后连接状态观测</dt>
                  <dd>
                    {computer?.lastSeenAt
                      ? new Date(computer.lastSeenAt).toLocaleString()
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Host ID</dt>
                  <dd>{hostId}</dd>
                </div>
                <div>
                  <dt>检测到的运行时</dt>
                  <dd className="rah-computer-runtime-chips">
                    {runtimes.map((runtime) => (
                      <span
                        className={runtime.available ? "" : "is-missing"}
                        key={runtimeInventoryKey(runtime)}
                      >
                        {runtime.displayName}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>可运行 Offer</dt>
                  <dd>{configuredRuntimes.length}</dd>
                </div>
              </dl>
            </section>
            <section className="rah-computer-content-stack">
              <header>
                <h2>
                  <Icon name="members" /> 这台 Computer 上的 AGENT
                  <span>{bindings.length}</span>
                </h2>
              </header>
              {bindings.length === 0 ? (
                <p className="rah-computer-hint">当前没有绑定的 Agent。</p>
              ) : (
                <div className="rah-computer-agent-list">
                  {bindings.map((binding) => (
                    <article key={binding.agentDefinitionId}>
                      <span>{binding.handle.slice(0, 1).toUpperCase()}</span>
                      <b>{binding.handle}</b>
                      <code>{binding.runtimeLabel}</code>
                      <small>
                        <i
                          className={
                            online &&
                            agents.some(
                              (agent) =>
                                agent.agentDefinitionId ===
                                  binding.agentDefinitionId &&
                                agent.state === "enabled" &&
                                agent.runtimeAvailable,
                            )
                              ? "is-online"
                              : ""
                          }
                        />
                        {agents.find(
                          (agent) =>
                            agent.agentDefinitionId ===
                            binding.agentDefinitionId,
                        )?.state === "disabled"
                          ? "已暂停"
                          : online &&
                              agents.some(
                                (agent) =>
                                  agent.agentDefinitionId ===
                                    binding.agentDefinitionId &&
                                  agent.runtimeAvailable,
                              )
                            ? "可用"
                            : "不可用"}
                      </small>
                    </article>
                  ))}
                </div>
              )}
              <section className="rah-computer-runtime-evidence">
                <h2>CLI / RUNTIME / OFFER</h2>
                {runtimes.map((runtime) => (
                  <article key={runtimeInventoryKey(runtime)}>
                    <header>
                      <b>{runtime.displayName}</b>
                      <span>{runtime.version ?? "版本未知"}</span>
                    </header>
                    <dl>
                      <div>
                        <dt>Executable</dt>
                        <dd>
                          {runtime.resolvedExecutablePath ?? runtime.executable}
                        </dd>
                      </div>
                      <div>
                        <dt>Runtime Profile</dt>
                        <dd>{runtime.runtimeProfileId ?? "未配置"}</dd>
                      </div>
                      <div>
                        <dt>Offer</dt>
                        <dd>{runtime.runtimeOfferId ?? "未发布"}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </section>
            </section>
          </div>
        </section>
      )}
    </main>
  );
}

function ComputerField({
  children,
  label,
  muted = false,
}: {
  children: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <section className="rah-computer-field">
      <h2>{label}</h2>
      <p className={muted ? "is-muted" : undefined}>{children}</p>
    </section>
  );
}

function displayComputerName(hostId: string | undefined): string {
  if (hostId === undefined) return "本机 Computer";
  return hostId.startsWith("local-workbench-host-") ? "本机 Computer" : hostId;
}

function uniqueBindings(
  runtimes: readonly LocalRuntimeInventoryEntry[],
): Array<{
  agentDefinitionId: string;
  handle: string;
  runtimeLabel: string;
}> {
  const bindings = new Map<
    string,
    { agentDefinitionId: string; handle: string; runtimeLabel: string }
  >();
  for (const runtime of runtimes) {
    for (const binding of runtime.agentBindings) {
      bindings.set(binding.agentDefinitionId, {
        agentDefinitionId: binding.agentDefinitionId,
        handle: binding.handle,
        runtimeLabel: runtime.displayName,
      });
    }
  }
  return [...bindings.values()];
}

function runtimeInventoryKey(runtime: LocalRuntimeInventoryEntry): string {
  return [
    runtime.runtimeProfileId ?? "discovered",
    runtime.executable,
    runtime.displayName,
  ].join(":");
}
