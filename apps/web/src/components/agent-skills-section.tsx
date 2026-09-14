import { skillSourceLabel } from "../agent-skills-presentation.ts";
import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  AgentSkill,
  AgentSkillsList,
  AgentSkillsScope,
} from "@rah-os/protocol";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

// Raft release/v1.12.0 AgentDetailPanel ic/rc/lc/Ps/oc: source groups and cards.
export function AgentSkillsSection({
  client,
  agentDefinitionId,
  executionPolicyRevisionId,
}: {
  client: RahClient;
  agentDefinitionId: string;
  executionPolicyRevisionId: string;
}) {
  const key = `${agentDefinitionId}:${executionPolicyRevisionId}`;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    key: string;
    result?: AgentSkillsList;
    error?: string;
  }>({ key });
  useEffect(() => {
    const controller = new AbortController();
    setState({ key });
    void client
      .request(
        "agent.skills.list",
        { agentDefinitionId },
        { signal: controller.signal },
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.executionPolicyRevisionId !== executionPolicyRevisionId) {
          setState({
            key,
            error: "Agent 的运行配置已变化，请刷新资料后重试。",
          });
          return;
        }
        setState({ key, result });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            key,
            error: error instanceof Error ? error.message : "无法读取技能",
          });
      });
    return () => controller.abort();
  }, [client, agentDefinitionId, executionPolicyRevisionId, key, retry]);
  const visible = state.key === key ? state : undefined;
  const result = visible?.result;
  const allReadable =
    result &&
    [result.global, result.workspace].every(
      (scope) => scope.state === "ready" || scope.state === "partial",
    );
  return (
    <ProfileSection
      title="技能"
      count={
        allReadable
          ? result.global.skills.length + result.workspace.skills.length
          : undefined
      }
      className="rah-agent-skills-section"
    >
      {visible?.error ? (
        <div className="rah-agent-skills-error" role="alert">
          <p>{visible.error}</p>
          <button
            className="btn btn-brutal-sm"
            onClick={() => setRetry((value) => value + 1)}
          >
            <Icon name="refresh-cw" />
            重试
          </button>
        </div>
      ) : !result ? (
        <p className="rah-agent-profile-status" role="status">
          正在加载技能…
        </p>
      ) : (
        <div className="rah-agent-skills-scopes">
          <SkillsScope
            label="全局"
            icon="globe"
            scope={result.global}
            empty="暂无全局技能"
          />
          <SkillsScope
            label="工作区"
            icon="folder"
            scope={result.workspace}
            empty="此 Agent 工作区内暂无 skill"
          />
          {[result.global, result.workspace].some(
            (scope) => scope.state === "error" || scope.state === "partial",
          ) ? (
            <button
              className="btn btn-brutal-sm"
              onClick={() => setRetry((value) => value + 1)}
            >
              重试
            </button>
          ) : null}
        </div>
      )}
    </ProfileSection>
  );
}
function SkillsScope({
  label,
  icon,
  scope,
  empty,
}: {
  label: string;
  icon: string;
  scope: AgentSkillsScope;
  empty: string;
}) {
  const groups = new Map<string, AgentSkill[]>();
  for (const skill of scope.skills)
    groups.set(skill.sourcePath, [
      ...(groups.get(skill.sourcePath) ?? []),
      skill,
    ]);
  const readable = scope.state === "ready" || scope.state === "partial";
  return (
    <section className="rah-agent-skills-scope" aria-label={`${label}技能`}>
      <h4>
        <Icon name={icon} />
        {label}
        {readable ? <span>({scope.skills.length})</span> : null}
      </h4>
      {scope.state === "unavailable" ? (
        <p className="rah-agent-profile-status">
          {scope.issues.includes("unsupported_runtime")
            ? "当前 CLI 的技能目录读取尚未接入。"
            : "无法确认当前 CLI 的有效技能目录。"}
        </p>
      ) : (
        <>
          {scope.state !== "ready" ? (
            <p className="rah-agent-profile-status" role="status">
              {scope.truncated
                ? "技能列表达到读取上限，仅显示已读取的部分。"
                : "部分技能目录或元信息无法安全读取。"}
            </p>
          ) : null}
          {scope.skills.length === 0 ? (
            scope.state === "ready" ? (
              <p className="rah-agent-skills-empty">{empty}</p>
            ) : null
          ) : (
            <div className="rah-agent-skills-groups">
              {[...groups].map(([path, skills]) => (
                <div key={path}>
                  <div className="rah-agent-skills-source">
                    <code title={path}>{skillSourceLabel(path)}</code>
                    <span>({skills.length})</span>
                  </div>
                  <div className="rah-agent-skill-list">
                    {skills.map((skill) => (
                      <article key={skill.name}>
                        <div className="rah-agent-skill-name">
                          <b>{skill.displayName}</b>
                          {skill.userInvocable ? (
                            <span className="rah-agent-skill-command">
                              /{skill.name}
                            </span>
                          ) : null}
                        </div>
                        {skill.description ? (
                          <p className="rah-agent-skill-description">
                            {skill.description}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
