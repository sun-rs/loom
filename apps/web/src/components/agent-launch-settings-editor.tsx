import type { useAgentEnvironmentDraft } from "../use-agent-environment-draft.ts";
import { RuntimeEnvironmentEditor } from "./runtime-environment-editor.tsx";

export function AgentLaunchSettingsEditor({
  draft,
  blocked,
}: {
  draft: ReturnType<typeof useAgentEnvironmentDraft>;
  blocked: boolean;
}) {
  return (
    <details className="rah-agent-launch-settings">
      <summary>更多</summary>
      {draft.error && <p role="alert">{draft.error}</p>}
      {!draft.ready && !draft.error && <p role="status">正在读取环境变量…</p>}
      {!draft.ready && (
        <button
          className="btn"
          type="button"
          disabled={blocked}
          onClick={draft.retry}
        >
          重新加载配置
        </button>
      )}
      <RuntimeEnvironmentEditor
        rows={draft.rows}
        disabled={blocked}
        onChange={draft.setRows}
      />
    </details>
  );
}
