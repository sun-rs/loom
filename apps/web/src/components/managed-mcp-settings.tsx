import { useEffect, useMemo, useState } from "react";

import { RoomSession, runRoomMutationAtLatest } from "@rah-os/client-core";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  ManagedMcpAssignmentRecord,
  ManagedMcpExecutorDescriptor,
  ManagedMcpServerDefinition,
  ManagedMcpServerRecord,
  ManagedMcpToolDefinition,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import { useDialogProtocol } from "../dialog-protocol.ts";
import { Icon } from "./icon.tsx";
import { SettingsPageHeader } from "./settings-primitives.tsx";

type ServerEditorValue = {
  definition: ManagedMcpServerDefinition;
  expectedConfigVersion?: number;
  mcpServerId?: string;
};

export function ManagedMcpSettingsContent({
  agents,
  canRead,
  canWrite,
  client,
  consumerPrefix,
  controlRoomId,
}: {
  agents: readonly WorkspaceAgentView[];
  canRead: boolean;
  canWrite: boolean;
  client: RahClient;
  consumerPrefix: string;
  controlRoomId: string | undefined;
}) {
  const [assignments, setAssignments] = useState<ManagedMcpAssignmentRecord[]>(
    [],
  );
  const [executors, setExecutors] = useState<ManagedMcpExecutorDescriptor[]>(
    [],
  );
  const [servers, setServers] = useState<ManagedMcpServerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [pendingAction, setPendingAction] = useState<string>();
  const [serverEditor, setServerEditor] = useState<
    ManagedMcpServerRecord | "create"
  >();
  const [assignmentEditor, setAssignmentEditor] = useState<{
    assignment?: ManagedMcpAssignmentRecord;
    server: ManagedMcpServerRecord;
  }>();
  const controlSession = useMemo(
    () =>
      controlRoomId === undefined
        ? undefined
        : new RoomSession({
            client,
            consumerId: `${consumerPrefix}-managed-mcp-${controlRoomId}`,
            roomId: controlRoomId,
          }),
    [client, consumerPrefix, controlRoomId],
  );

  useEffect(() => {
    if (!canRead || controlRoomId === undefined) {
      setAssignments([]);
      setExecutors([]);
      setServers([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    void Promise.all([
      client.request(
        "managedMcp.executor.list",
        { controlRoomId },
        { signal: controller.signal },
      ),
      client.request(
        "managedMcp.server.list",
        { controlRoomId },
        { signal: controller.signal },
      ),
      client.request(
        "managedMcp.assignment.list",
        { controlRoomId },
        { signal: controller.signal },
      ),
    ])
      .then(([executorResult, serverResult, assignmentResult]) => {
        setExecutors(executorResult.executors);
        setServers(serverResult.servers);
        setAssignments(assignmentResult.assignments);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canRead, client, controlRoomId]);

  const discover = async (
    executorRef: string,
  ): Promise<ManagedMcpToolDefinition[]> => {
    if (controlRoomId === undefined) {
      throw new Error("当前 Workspace 没有 control Room");
    }
    const result = await client.request("managedMcp.executor.discover", {
      controlRoomId,
      executorRef,
    });
    return result.tools;
  };

  const saveServer = async (value: ServerEditorValue) => {
    if (
      !canWrite ||
      controlRoomId === undefined ||
      controlSession === undefined
    ) {
      throw new Error("当前 Human 没有管理 MCP 服务器的权限");
    }
    const result =
      value.mcpServerId === undefined
        ? await runRoomMutationAtLatest({
            mutate: (basedOnRoomSeq) =>
              client.request("managedMcp.server.create", {
                basedOnRoomSeq,
                controlRoomId,
                definition: value.definition,
                idempotencyKey: `web-mcp-server-create-${browserOpaqueId()}`,
                mcpServerId: `mcp-${browserOpaqueId()}`,
              }),
            session: controlSession,
          })
        : await runRoomMutationAtLatest({
            mutate: (basedOnRoomSeq) =>
              client.request("managedMcp.server.revise", {
                basedOnRoomSeq,
                definition: value.definition,
                expectedConfigVersion: value.expectedConfigVersion ?? 1,
                idempotencyKey: `web-mcp-server-revise-${browserOpaqueId()}`,
                mcpServerId: value.mcpServerId!,
              }),
            session: controlSession,
          });
    setServers((current) => upsertServer(current, result.server));
    setServerEditor(undefined);
  };

  const setServerState = async (server: ManagedMcpServerRecord) => {
    if (!canWrite || controlSession === undefined) {
      throw new Error("当前 Human 没有管理 MCP 服务器的权限");
    }
    const result = await runRoomMutationAtLatest({
      mutate: (basedOnRoomSeq) =>
        client.request("managedMcp.server.state", {
          basedOnRoomSeq,
          expectedConfigVersion: server.configVersion,
          idempotencyKey: `web-mcp-server-state-${browserOpaqueId()}`,
          mcpServerId: server.mcpServerId,
          state: server.state === "enabled" ? "disabled" : "enabled",
        }),
      session: controlSession,
    });
    setServers((current) => upsertServer(current, result.server));
  };

  const saveAssignment = async (input: {
    allowedToolNames: string[];
    assignment?: ManagedMcpAssignmentRecord;
    participantId: string;
    server: ManagedMcpServerRecord;
  }) => {
    if (!canWrite || controlSession === undefined) {
      throw new Error("当前 Human 没有管理 MCP 分配的权限");
    }
    const result =
      input.assignment === undefined
        ? await runRoomMutationAtLatest({
            mutate: (basedOnRoomSeq) =>
              client.request("managedMcp.assignment.create", {
                allowedToolNames: input.allowedToolNames,
                basedOnRoomSeq,
                idempotencyKey: `web-mcp-assignment-create-${browserOpaqueId()}`,
                mcpServerId: input.server.mcpServerId,
                participantId: input.participantId,
              }),
            session: controlSession,
          })
        : await runRoomMutationAtLatest({
            mutate: (basedOnRoomSeq) =>
              client.request("managedMcp.assignment.revise", {
                allowedToolNames: input.allowedToolNames,
                basedOnRoomSeq,
                expectedAssignmentVersion:
                  input.assignment?.assignmentVersion ?? 1,
                idempotencyKey: `web-mcp-assignment-revise-${browserOpaqueId()}`,
                mcpServerId: input.server.mcpServerId,
                participantId: input.participantId,
              }),
            session: controlSession,
          });
    setAssignments((current) => upsertAssignment(current, result.assignment));
    setAssignmentEditor(undefined);
  };

  const setAssignmentState = async (assignment: ManagedMcpAssignmentRecord) => {
    if (!canWrite || controlSession === undefined) {
      throw new Error("当前 Human 没有管理 MCP 分配的权限");
    }
    const result = await runRoomMutationAtLatest({
      mutate: (basedOnRoomSeq) =>
        client.request("managedMcp.assignment.state", {
          basedOnRoomSeq,
          expectedAssignmentVersion: assignment.assignmentVersion,
          idempotencyKey: `web-mcp-assignment-state-${browserOpaqueId()}`,
          mcpServerId: assignment.mcpServerId,
          participantId: assignment.participantId,
          state: assignment.enabled ? "disabled" : "enabled",
        }),
      session: controlSession,
    });
    setAssignments((current) => upsertAssignment(current, result.assignment));
  };

  const runInlineAction = (key: string, action: () => Promise<void>) => {
    if (pendingAction !== undefined) return;
    setPendingAction(key);
    setActionError(undefined);
    void action()
      .catch((caught) => setActionError(errorMessage(caught)))
      .finally(() => setPendingAction(undefined));
  };

  return (
    <>
      <section className="rah-settings-content">
        <SettingsPageHeader
          badge={<span className="rah-count-badge">{servers.length}</span>}
          icon="blocks"
          title="MCP 服务器"
          action={
            <button
              className="btn"
              disabled={!canWrite || executors.length === 0}
              onClick={() => setServerEditor("create")}
              title={
                executors.length === 0
                  ? "daemon 尚未配置可用的 MCP executor"
                  : "添加 MCP 服务器"
              }
            >
              添加服务器
            </button>
          }
        />
        <div className="rah-settings-scroll rah-scroll-main">
          <p className="rah-settings-intro">
            配置此 RAH Workspace 的 MCP 目录、工具白名单和 Agent
            分配。连接凭据由 daemon 的 SecretProvider 持有，不进入浏览器。
          </p>
          {actionError === undefined ? null : (
            <div className="rah-inline-error" role="alert">
              {actionError}
            </div>
          )}
          {!canRead ? (
            <SettingsEmptyState
              detail="当前 daemon 没有开放 managed MCP read capability；页面不会用本地 fixture 代替。"
              title="MCP 管理不可用"
            />
          ) : loading ? (
            <SettingsEmptyState
              detail="正在读取 canonical 配置…"
              title="加载中"
            />
          ) : loadError !== undefined ? (
            <SettingsEmptyState detail={loadError} title="无法读取 MCP 配置" />
          ) : servers.length === 0 ? (
            <SettingsEmptyState
              detail={
                executors.length === 0
                  ? "先在 daemon 配置中登记 Streamable HTTP executor 和 owner-private secret。"
                  : "从已验证的 executor 发现工具并创建第一个托管 MCP 服务器。"
              }
              title="暂无托管 MCP 服务器"
            />
          ) : (
            <div className="rah-mcp-server-list">
              {servers.map((server) => {
                const serverAssignments = assignments.filter(
                  ({ mcpServerId }) => mcpServerId === server.mcpServerId,
                );
                return (
                  <ManagedMcpServerCard
                    agents={agents}
                    assignments={serverAssignments}
                    busy={pendingAction !== undefined}
                    canWrite={canWrite}
                    key={server.mcpServerId}
                    onAssignmentEdit={(assignment) =>
                      setAssignmentEditor({ assignment, server })
                    }
                    onAssignmentState={(assignment) =>
                      runInlineAction(
                        `assignment:${assignment.assignmentId}`,
                        () => setAssignmentState(assignment),
                      )
                    }
                    onAssign={() => setAssignmentEditor({ server })}
                    onEdit={() => setServerEditor(server)}
                    onState={() =>
                      runInlineAction(`server:${server.mcpServerId}`, () =>
                        setServerState(server),
                      )
                    }
                    server={server}
                  />
                );
              })}
            </div>
          )}
          <section className="rah-mcp-executor-inventory">
            <header>
              <h2>已配置连接</h2>
              <span>{executors.length}</span>
            </header>
            {executors.length === 0 ? (
              <p>没有可向浏览器公开的 executor 引用。</p>
            ) : (
              executors.map((executor) => (
                <div key={executor.executorRef}>
                  <b>{executor.executorRef}</b>
                  <span>{executor.transportKind}</span>
                </div>
              ))
            )}
          </section>
        </div>
      </section>
      {serverEditor === undefined ? null : (
        <ManagedMcpServerDialog
          executors={executors}
          initial={serverEditor === "create" ? undefined : serverEditor}
          onClose={() => setServerEditor(undefined)}
          onDiscover={discover}
          onSave={saveServer}
        />
      )}
      {assignmentEditor === undefined ? null : (
        <ManagedMcpAssignmentDialog
          agents={
            assignmentEditor.assignment === undefined
              ? agents.filter(
                  ({ participantId }) =>
                    !assignments.some(
                      (assignment) =>
                        assignment.mcpServerId ===
                          assignmentEditor.server.mcpServerId &&
                        assignment.participantId === participantId,
                    ),
                )
              : agents
          }
          initial={assignmentEditor.assignment}
          onClose={() => setAssignmentEditor(undefined)}
          onSave={(value) =>
            saveAssignment({ ...value, server: assignmentEditor.server })
          }
          server={assignmentEditor.server}
        />
      )}
    </>
  );
}

function SettingsEmptyState({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  return (
    <div className="rah-mcp-empty-state">
      <Icon name="code-xml" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function ManagedMcpServerCard({
  agents,
  assignments,
  busy,
  canWrite,
  onAssignmentEdit,
  onAssignmentState,
  onAssign,
  onEdit,
  onState,
  server,
}: {
  agents: readonly WorkspaceAgentView[];
  assignments: readonly ManagedMcpAssignmentRecord[];
  busy: boolean;
  canWrite: boolean;
  onAssignmentEdit: (assignment: ManagedMcpAssignmentRecord) => void;
  onAssignmentState: (assignment: ManagedMcpAssignmentRecord) => void;
  onAssign: () => void;
  onEdit: () => void;
  onState: () => void;
  server: ManagedMcpServerRecord;
}) {
  const agentById = new Map(
    agents.map((agent) => [agent.participantId, agent]),
  );
  return (
    <article className="rah-mcp-server-card">
      <header>
        <span className="rah-mcp-server-icon">
          <Icon name="code-xml" />
        </span>
        <div>
          <h2>{server.definition.serverName}</h2>
          <p>{server.definition.executorRef}</p>
        </div>
        <span className={`rah-mcp-state is-${server.state}`}>
          {server.state === "enabled" ? "已启用" : "已停用"}
        </span>
        <button className="btn" disabled={!canWrite || busy} onClick={onEdit}>
          编辑
        </button>
        <button className="btn" disabled={!canWrite || busy} onClick={onState}>
          {server.state === "enabled" ? "停用" : "启用"}
        </button>
      </header>
      <div className="rah-mcp-tool-summary">
        <b>{server.definition.tools.length} 个工具</b>
        <span>{server.definition.runtimeName}</span>
        <div>
          {server.definition.tools.slice(0, 6).map((tool) => (
            <code key={tool.toolName} title={tool.title ?? tool.toolName}>
              {tool.toolName}
            </code>
          ))}
          {server.definition.tools.length > 6 ? (
            <code>+{server.definition.tools.length - 6}</code>
          ) : null}
        </div>
      </div>
      <section className="rah-mcp-assignment-list">
        <header>
          <b>Agent 访问</b>
          <button
            className="btn"
            disabled={
              !canWrite ||
              busy ||
              agents.every((agent) =>
                assignments.some(
                  ({ participantId }) => participantId === agent.participantId,
                ),
              )
            }
            onClick={onAssign}
          >
            分配 Agent
          </button>
        </header>
        {assignments.length === 0 ? (
          <p>尚未向任何 Agent 开放工具。</p>
        ) : (
          assignments.map((assignment) => (
            <div key={assignment.assignmentId}>
              <span className="rah-runtime-icon">
                {(agentById.get(assignment.participantId)?.displayName ?? "A")
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <span>
                <b>
                  {agentById.get(assignment.participantId)?.displayName ??
                    assignment.participantId}
                </b>
                <small>{assignment.allowedToolNames.length} 个工具</small>
              </span>
              <i>{assignment.enabled ? "已启用" : "已停用"}</i>
              <button
                className="btn"
                disabled={!canWrite || busy}
                onClick={() => onAssignmentEdit(assignment)}
              >
                编辑
              </button>
              <button
                className="btn"
                disabled={!canWrite || busy}
                onClick={() => onAssignmentState(assignment)}
              >
                {assignment.enabled ? "停用" : "启用"}
              </button>
            </div>
          ))
        )}
      </section>
    </article>
  );
}

function ManagedMcpServerDialog({
  executors,
  initial,
  onClose,
  onDiscover,
  onSave,
}: {
  executors: readonly ManagedMcpExecutorDescriptor[];
  initial: ManagedMcpServerRecord | undefined;
  onClose: () => void;
  onDiscover: (executorRef: string) => Promise<ManagedMcpToolDefinition[]>;
  onSave: (value: ServerEditorValue) => Promise<void>;
}) {
  const [executorRef, setExecutorRef] = useState(
    initial?.definition.executorRef ?? executors[0]?.executorRef ?? "",
  );
  const [serverName, setServerName] = useState(
    initial?.definition.serverName ?? "",
  );
  const [runtimeName, setRuntimeName] = useState(
    initial?.definition.runtimeName ?? runtimeNameFromExecutor(executorRef),
  );
  const [tools, setTools] = useState<ManagedMcpToolDefinition[]>(
    initial?.definition.tools ?? [],
  );
  const [pending, setPending] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({
    blocked: pending || discovering,
    onClose,
  });
  const valid =
    executorRef !== "" &&
    serverName.trim() !== "" &&
    runtimeName.trim() !== "" &&
    tools.length > 0;

  const discover = () => {
    if (executorRef === "") return;
    setDiscovering(true);
    setActionError(undefined);
    void onDiscover(executorRef)
      .then((nextTools) => {
        setTools(nextTools);
        if (serverName.trim() === "") setServerName(executorRef);
        if (runtimeName.trim() === "") {
          setRuntimeName(runtimeNameFromExecutor(executorRef));
        }
      })
      .catch((caught) => setActionError(errorMessage(caught)))
      .finally(() => setDiscovering(false));
  };

  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭 MCP 服务器窗口"
        className="rah-dialog-backdrop"
        disabled={pending || discovering}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-mcp-server-dialog-title"
        aria-modal="true"
        className="rah-dialog rah-mcp-server-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-mcp-server-dialog-title">
              {initial === undefined ? "新建 MCP 服务器" : "编辑 MCP 服务器"}
            </h2>
            <p>RAH Kernel 版本化目录；daemon 持有连接与凭据。</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending || discovering}
            onClick={onClose}
          >
            <span aria-hidden="true" className="rah-close-glyph">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            setPending(true);
            setActionError(undefined);
            void onSave({
              definition: {
                executorRef,
                runtimeName: runtimeName.trim(),
                serverName: serverName.trim(),
                tools,
              },
              ...(initial === undefined
                ? {}
                : {
                    expectedConfigVersion: initial.configVersion,
                    mcpServerId: initial.mcpServerId,
                  }),
            })
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <p className="rah-dialog-copy">
            先执行“测试连接”读取真实 tools/list。未发现工具时不能保存。
          </p>
          <label>
            已配置连接
            <select
              disabled={pending || discovering}
              onChange={(event) => {
                const next = event.target.value;
                setExecutorRef(next);
                setRuntimeName(runtimeNameFromExecutor(next));
                setTools([]);
              }}
              value={executorRef}
            >
              {executors.map((executor) => (
                <option key={executor.executorRef} value={executor.executorRef}>
                  {executor.executorRef}
                </option>
              ))}
            </select>
          </label>
          <label>
            名称
            <input
              maxLength={512}
              onChange={(event) => setServerName(event.target.value)}
              placeholder="Notion"
              value={serverName}
            />
          </label>
          <label>
            Runtime 名称
            <input
              maxLength={256}
              onChange={(event) => setRuntimeName(event.target.value)}
              placeholder="notion"
              value={runtimeName}
            />
          </label>
          <div className="rah-mcp-discovery-row">
            <button
              className="btn"
              disabled={executorRef === "" || pending || discovering}
              onClick={discover}
              type="button"
            >
              {discovering ? "正在测试…" : "测试连接"}
            </button>
            <span>
              {tools.length === 0
                ? "尚未发现工具"
                : `已发现 ${tools.length} 个工具`}
            </span>
          </div>
          {tools.length === 0 ? null : (
            <div className="rah-mcp-discovered-tools">
              {tools.map((tool) => (
                <div key={tool.toolName}>
                  <b>{tool.title ?? tool.toolName}</b>
                  <code>{tool.toolName}</code>
                  <span>{tool.description ?? "无描述"}</span>
                </div>
              ))}
            </div>
          )}
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending || discovering}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="btn btn-pink"
              disabled={!valid || pending || discovering}
            >
              {pending ? "保存中…" : "保存"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ManagedMcpAssignmentDialog({
  agents,
  initial,
  onClose,
  onSave,
  server,
}: {
  agents: readonly WorkspaceAgentView[];
  initial: ManagedMcpAssignmentRecord | undefined;
  onClose: () => void;
  onSave: (input: {
    allowedToolNames: string[];
    assignment?: ManagedMcpAssignmentRecord;
    participantId: string;
  }) => Promise<void>;
  server: ManagedMcpServerRecord;
}) {
  const [participantId, setParticipantId] = useState(
    initial?.participantId ?? agents[0]?.participantId ?? "",
  );
  const [selectedTools, setSelectedTools] = useState(
    new Set(
      initial?.allowedToolNames ??
        server.definition.tools.map(({ toolName }) => toolName),
    ),
  );
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const valid = participantId !== "" && selectedTools.size > 0;
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭 MCP Agent 分配窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-mcp-assignment-title"
        aria-modal="true"
        className="rah-dialog rah-mcp-assignment-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-mcp-assignment-title">Agent MCP 权限</h2>
            <p>{server.definition.serverName} · 显式工具白名单</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span aria-hidden="true" className="rah-close-glyph">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            setPending(true);
            setActionError(undefined);
            void onSave({
              allowedToolNames: [...selectedTools].sort(),
              ...(initial === undefined ? {} : { assignment: initial }),
              participantId,
            })
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <label>
            Agent
            <select
              disabled={initial !== undefined || pending}
              onChange={(event) => setParticipantId(event.target.value)}
              value={participantId}
            >
              {agents.map((agent) => (
                <option key={agent.participantId} value={agent.participantId}>
                  {agent.displayName} (@{agent.handle})
                </option>
              ))}
            </select>
          </label>
          <fieldset className="rah-mcp-tool-permissions">
            <legend>允许的工具</legend>
            {server.definition.tools.map((tool) => (
              <label key={tool.toolName}>
                <input
                  checked={selectedTools.has(tool.toolName)}
                  disabled={pending}
                  onChange={(event) => {
                    setSelectedTools((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(tool.toolName);
                      else next.delete(tool.toolName);
                      return next;
                    });
                  }}
                  type="checkbox"
                />
                <span>
                  <b>{tool.title ?? tool.toolName}</b>
                  <small>{tool.description ?? tool.toolName}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="btn btn-pink" disabled={!valid || pending}>
              {pending ? "保存中…" : "保存权限"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function upsertServer(
  current: readonly ManagedMcpServerRecord[],
  server: ManagedMcpServerRecord,
): ManagedMcpServerRecord[] {
  return current.some(({ mcpServerId }) => mcpServerId === server.mcpServerId)
    ? current.map((existing) =>
        existing.mcpServerId === server.mcpServerId ? server : existing,
      )
    : [...current, server];
}

function upsertAssignment(
  current: readonly ManagedMcpAssignmentRecord[],
  assignment: ManagedMcpAssignmentRecord,
): ManagedMcpAssignmentRecord[] {
  return current.some(
    ({ assignmentId }) => assignmentId === assignment.assignmentId,
  )
    ? current.map((existing) =>
        existing.assignmentId === assignment.assignmentId
          ? assignment
          : existing,
      )
    : [...current, assignment];
}

function runtimeNameFromExecutor(executorRef: string): string {
  return executorRef
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 256);
}

function browserOpaqueId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "MCP 操作失败";
}
