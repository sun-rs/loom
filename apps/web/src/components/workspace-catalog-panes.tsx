import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import { Icon } from "./icon.tsx";

export function AgentDirectoryPane({
  agents,
  canCreate,
  onCreate,
  onManage,
}: {
  agents: readonly WorkspaceAgentView[];
  canCreate: boolean;
  onCreate: () => void;
  onManage: (agentDefinitionId: string) => void;
}) {
  return (
    <main className="channel rah-agent-runtime-page">
      <header className="channel-head">
        <div className="channel-id">
          <span className="channel-badge">
            <Icon name="members" />
          </span>
          <div className="channel-title">
            <h1>Agent 与成员</h1>
            <p className="channel-sub">
              {agents.length} 个 Workspace Agent 长期身份
            </p>
          </div>
        </div>
        <div className="head-actions">
          <button
            className="btn btn-pink"
            disabled={!canCreate}
            onClick={onCreate}
            title={
              canCreate
                ? "创建 Workspace Agent"
                : "需要管理员权限和可用 Runtime"
            }
          >
            创建 Agent
          </button>
        </div>
      </header>
      <section className="rah-runtime-summary">
        <strong>Agent 是长期身份</strong>
        <span>
          这里管理 Workspace Agent；加入或移出某个 Room，请从该 Room
          标题栏的成员面板操作。Runtime 与本机 CLI 位于“计算机”。
        </span>
      </section>
      <section className="rah-runtime-grid rah-scroll-main">
        {agents.length === 0 ? (
          <p className="rah-empty-copy">
            当前没有可见 AgentDefinition。请先确认 daemon 已探测并启用了真实
            Runtime，然后创建 Workspace Agent。
          </p>
        ) : null}
        {agents.map((agent) => (
          <article className="rah-runtime-card" key={agent.agentDefinitionId}>
            <header>
              <span className="rah-runtime-icon">
                {agent.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2>{agent.displayName}</h2>
                <p>
                  @{agent.handle} · {agent.role}
                </p>
              </div>
              <span
                className={`rah-runtime-state ${agent.state === "enabled" ? "is-online" : "is-offline"}`}
              >
                {agent.state === "enabled" ? "已启用" : "已暂停"}
              </span>
            </header>
            <dl>
              <div>
                <dt>Identity</dt>
                <dd>{agent.participantId}</dd>
              </div>
              <div>
                <dt>Definition</dt>
                <dd>{agent.agentDefinitionId}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>
                  {agent.runtimeLabels.length === 0
                    ? "未绑定"
                    : agent.runtimeLabels.join(", ")}
                </dd>
              </div>
            </dl>
            <p className="rah-runtime-note">
              {agent.description === undefined ? null : (
                <>
                  {agent.description}
                  <br />
                </>
              )}
              {agent.runtimeAvailable
                ? "至少一个已绑定 Runtime 当前可运行。"
                : "当前没有已验证且可用的 Runtime。"}
            </p>
            <footer className="rah-runtime-card-actions">
              <button
                className="btn"
                disabled={!canCreate}
                onClick={() => onManage(agent.agentDefinitionId)}
              >
                编辑
              </button>
            </footer>
          </article>
        ))}
      </section>
    </main>
  );
}

export function ComputerRuntimePane({
  inventoryError,
  runtimes,
}: {
  inventoryError: string | undefined;
  runtimes: readonly LocalRuntimeInventoryEntry[];
}) {
  const configuredCount = runtimes.filter(
    ({ available, configured }) => available && configured,
  ).length;
  return (
    <main className="channel rah-agent-runtime-page">
      <header className="channel-head">
        <div className="channel-id">
          <span className="channel-badge">
            <Icon name="monitor" />
          </span>
          <div className="channel-title">
            <h1>计算机与 Runtime</h1>
            <p className="channel-sub">{configuredCount} 个运行插槽可用</p>
          </div>
        </div>
      </header>
      <section className="rah-runtime-summary">
        <strong>Agent 身份与 CLI 解耦</strong>
        <span>
          daemon 负责探测本机 CLI 并发布 Runtime/Offer 证据。这里不修改任何 Room
          成员；安装或修改 CLI 后需要重启 daemon 才会重新扫描。
        </span>
      </section>
      {inventoryError === undefined ? null : (
        <div className="rah-inline-error">
          本机 Runtime 管理 API 不可用：{inventoryError}
        </div>
      )}
      <section className="rah-runtime-grid rah-scroll-main">
        {runtimes.length === 0 && inventoryError === undefined ? (
          <p className="rah-empty-copy">没有发现本机 Agent CLI。</p>
        ) : null}
        {runtimes.map((runtime, runtimeIndex) => (
          <article
            className="rah-runtime-card"
            key={`${runtime.runtimeProfileId ?? runtime.executable}-${String(runtimeIndex)}`}
          >
            <header>
              <span className="rah-runtime-icon">
                {runtime.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2>{runtime.displayName}</h2>
                <p>{runtime.version ?? runtime.executable}</p>
              </div>
              <span
                className={`rah-runtime-state ${runtime.available ? "is-online" : "is-offline"}`}
              >
                {runtime.available
                  ? runtime.configured
                    ? "可运行"
                    : "已安装 / 未启用"
                  : "未发现"}
              </span>
            </header>
            <dl>
              <div>
                <dt>Executable</dt>
                <dd>{runtime.resolvedExecutablePath ?? runtime.executable}</dd>
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
            {runtime.agentBindings.length === 0 ? (
              <p className="rah-runtime-note">
                {runtime.configured
                  ? "该 Runtime 尚未绑定 AgentDefinition。"
                  : "本次 daemon 启动时未启用；重启并纳入本机配置后才能加入 Room。"}
              </p>
            ) : (
              <div className="rah-agent-bindings">
                {runtime.agentBindings.map((binding) => (
                  <div
                    className="rah-agent-binding"
                    key={binding.agentDefinitionId}
                  >
                    <div>
                      <b>{binding.handle}</b>
                      <span>{binding.agentDefinitionId}</span>
                    </div>
                    <span className="rah-runtime-binding-label">已绑定</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
