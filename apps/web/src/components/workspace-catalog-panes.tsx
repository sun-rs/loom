import type { AgentResetOperation } from "../agent-reset-batch.ts";
import type { RahClient } from "@rah-os/client-sdk";
import { ComputerWorkspaceSummary } from "./computer-workspace-summary.tsx";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

import type {
  ClientComputerProfileUpdateRequest,
  LocalRuntimeInventoryEntry,
  LocalComputerObservation,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { computerStatusLabel } from "../attention-presentation.ts";

import {
  clampComputerSidebarWidth,
  nextComputerSidebarWidth,
  readComputerSidebarWidth,
  RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH,
  RAFT_COMPUTER_SIDEBAR_MAX_WIDTH,
  RAFT_COMPUTER_SIDEBAR_MIN_WIDTH,
  writeComputerSidebarWidth,
} from "../computer-sidebar-resize.ts";
import { localComputerDiagnosticText } from "../computer-runtime-inspector-model.ts";
import {
  ComputerAgentControls,
  type ComputerAgentStateChange,
} from "./computer-agent-controls.tsx";
import { ComputerRuntimeInspector } from "./computer-runtime-inspector.tsx";
import { ComputerProfileFields } from "./computer-profile-fields.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { PanelHeaderIcon } from "@rah-os/ui-web/neo-brutalist/panel-header-icon";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";
import { formatRahDateTime } from "../date-time-presentation.ts";

export function ComputerRuntimePane({
  client,
  onCreateAgent,
  onSetAgentState,
  onResetAgent,
  fullResetEnabled = false,
  hostId,
  inventoryError,
  runtimes,
  computer,
  agents = [],
  canEditProfile = false,
  onDetailOpenChange,
  onOpenAgent,
  onUpdateComputerProfile,
}: {
  client?: RahClient;
  onCreateAgent?: (() => void) | undefined;
  onSetAgentState?: ComputerAgentStateChange | undefined;
  onResetAgent?: AgentResetOperation | undefined;
  fullResetEnabled?: boolean | undefined;
  hostId: string | undefined;
  inventoryError: string | undefined;
  runtimes: readonly LocalRuntimeInventoryEntry[];
  computer?: LocalComputerObservation | undefined;
  agents?: readonly WorkspaceAgentView[];
  canEditProfile?: boolean;
  onDetailOpenChange?: ((open: boolean) => void) | undefined;
  onOpenAgent: (agentDefinitionId: string) => void;
  onUpdateComputerProfile?: (
    input: ClientComputerProfileUpdateRequest,
  ) => Promise<void>;
}) {
  // Explicit local default. Raft also restores remembered selections; its root route may be empty.
  const [selected, setSelected] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    typeof window === "undefined"
      ? RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH
      : readComputerSidebarWidth(window.localStorage),
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  const [resizing, setResizing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<
    "diagnostic" | "doctor" | "error"
  >();
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const resizeOrigin = useRef<{ clientX: number; width: number } | undefined>(
    undefined,
  );
  const entities = useWorkspaceEntities();
  const computerName =
    entities?.computer?.displayName ??
    computer?.displayName ??
    displayComputerName(hostId);
  const statusLabel = computerStatusLabel(computer);
  const online = computer?.status === "online";
  const configuredRuntimes = runtimes.filter(
    ({ available, configured }) => available && configured,
  );
  const bindings = entities?.computerAgents() ?? [];
  const rootStyle = {
    "--rah-computer-sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  useEffect(() => () => clearTimeout(copyFeedbackTimer.current), []);

  function applySidebarWidth(width: number): void {
    sidebarWidthRef.current = width;
    setSidebarWidth(width);
  }

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
    applySidebarWidth(
      clampComputerSidebarWidth(origin.width + event.clientX - origin.clientX),
    );
  }

  function onResizePointerEnd(event: PointerEvent<HTMLDivElement>): void {
    resizeOrigin.current = undefined;
    setResizing(false);
    writeComputerSidebarWidth(window.localStorage, sidebarWidthRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const width = nextComputerSidebarWidth(sidebarWidth, event.key);
    if (width === undefined) return;
    event.preventDefault();
    applySidebarWidth(width);
    writeComputerSidebarWidth(window.localStorage, width);
  }

  async function copyComputerEvidence(
    kind: "diagnostic" | "doctor",
    text: string,
  ): Promise<void> {
    clearTimeout(copyFeedbackTimer.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(kind);
    } catch {
      setCopyFeedback("error");
    }
    copyFeedbackTimer.current = setTimeout(
      () => setCopyFeedback(undefined),
      2_000,
    );
  }

  return (
    <main
      className={`rah-computer-directory${selected ? " is-detail" : " is-list"}`}
      style={rootStyle}
    >
      <aside className="rah-computer-sidebar">
        <PanelHeader kind="sidebar">
          <strong>计算机</strong>
        </PanelHeader>
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
                onClick={() => {
                  setSelected(true);
                  onDetailOpenChange?.(true);
                }}
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
        aria-valuemax={RAFT_COMPUTER_SIDEBAR_MAX_WIDTH}
        aria-valuemin={RAFT_COMPUTER_SIDEBAR_MIN_WIDTH}
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
          <PanelHeader kind="surface" className="rah-computer-detail-head">
            <PanelHeaderAction
              aria-label="返回计算机列表"
              className="rah-computer-detail-back"
              onClick={() => {
                setSelected(false);
                onDetailOpenChange?.(false);
              }}
              type="button"
            >
              <Icon name="arrow-left" />
            </PanelHeaderAction>
            <PanelHeaderIcon name="monitor" />
            <h1 className="rah-panel-title">{computerName}</h1>
          </PanelHeader>
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
            <ComputerProfileFields
              canEdit={canEditProfile}
              computer={computer}
              hostId={hostId}
              onUpdate={onUpdateComputerProfile}
            />
            <ProfileSection title="信息" className="rah-computer-info">
              <dl className="rah-profile-fields">
                <div>
                  <dt>OS</dt>
                  <dd>{computer?.os ?? "—"}</dd>
                </div>
                <div>
                  <dt>Computer 版本</dt>
                  <dd>{computer?.buildVersion ?? "—"}</dd>
                </div>
                <div>
                  <dt>检测到的运行时</dt>
                  <dd className="rah-computer-runtime-chips">
                    {runtimes.map((runtime) => (
                      <ComputerRuntimeInspector
                        className={runtime.available ? "" : "is-missing"}
                        key={runtimeInventoryKey(runtime)}
                        runtime={runtime}
                      >
                        {runtime.displayName}
                      </ComputerRuntimeInspector>
                    ))}
                  </dd>
                </div>
              </dl>
            </ProfileSection>
            <ComputerAgentControls
              bindings={bindings}
              onCreate={onCreateAgent}
              onOpen={onOpenAgent}
              onSetState={onSetAgentState}
              onReset={onResetAgent}
              fullResetEnabled={fullResetEnabled}
            />
            <ComputerWorkspaceSummary
              client={client}
              agents={bindings}
              onOpen={onOpenAgent}
            />
            <ProfileSection title="本机诊断">
              <details className="rah-profile-disclosure">
                <summary>CLI / Runtime / Offer 详情</summary>
                <dl className="rah-profile-fields">
                  <div>
                    <dt>Host ID</dt>
                    <dd>{hostId}</dd>
                  </div>
                  <div>
                    <dt>最后连接状态观测</dt>
                    <dd>
                      {computer?.lastSeenAt
                        ? formatRahDateTime(computer.lastSeenAt, {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>可运行 Offer</dt>
                    <dd>{configuredRuntimes.length}</dd>
                  </div>
                </dl>
                <div className="rah-computer-runtime-evidence">
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
                            {runtime.resolvedExecutablePath ??
                              runtime.executable}
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
                </div>
              </details>
              <section className="rah-computer-diagnostics">
                <p>
                  复制经过裁剪的 Computer、Runtime 与 Agent
                  状态；不包含环境变量、凭据或 Provider 账号。
                </p>
                <button
                  className="btn"
                  onClick={() =>
                    void copyComputerEvidence(
                      "diagnostic",
                      localComputerDiagnosticText({
                        agents,
                        computer,
                        hostId,
                        runtimes,
                      }),
                    )
                  }
                  type="button"
                >
                  <Icon name="copy" />
                  {copyFeedback === "diagnostic" ? "已复制" : "复制诊断信息"}
                </button>
                <a
                  href="/help/local-workbench.html#recovery"
                  target="_blank"
                  rel="noreferrer"
                >
                  本机恢复指南
                </a>
                <p>需要进一步检查时，请在 RAH OS 项目目录运行：</p>
                <div className="rah-computer-command-row">
                  <code>npm run doctor:local-core</code>
                  <button
                    aria-label="复制本机诊断命令"
                    className="btn"
                    onClick={() =>
                      void copyComputerEvidence(
                        "doctor",
                        "npm run doctor:local-core",
                      )
                    }
                    type="button"
                  >
                    <Icon name="copy" />
                    {copyFeedback === "doctor" ? "已复制" : "复制"}
                  </button>
                </div>
                {copyFeedback === "error" ? (
                  <p className="rah-computer-copy-error" role="alert">
                    无法写入剪贴板，请手动复制。
                  </p>
                ) : null}
              </section>
            </ProfileSection>
          </div>
        </section>
      )}
    </main>
  );
}

function displayComputerName(hostId: string | undefined): string {
  if (hostId === undefined) return "本机 Computer";
  return hostId.startsWith("local-workbench-host-") ? "本机 Computer" : hostId;
}

function runtimeInventoryKey(runtime: LocalRuntimeInventoryEntry): string {
  return [
    runtime.runtimeProfileId ?? "discovered",
    runtime.executable,
    runtime.displayName,
  ].join(":");
}
