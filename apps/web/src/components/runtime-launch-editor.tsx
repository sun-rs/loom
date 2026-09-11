import { useEffect, useState } from "react";
import type { RuntimeGuideSettingsView } from "@rah-os/protocol";
import {
  formatLaunchArgs,
  parseLaunchArgs,
  launchAdditions,
} from "../runtime-launch-editor-model.ts";
type Row = RuntimeGuideSettingsView["runtimes"][number];
export function RuntimeLaunchEditor({
  row,
  busy,
  onSave,
}: {
  row: Row;
  busy: boolean;
  onSave: (args: string[]) => Promise<boolean>;
}) {
  const stored = formatLaunchArgs(
    row.overrideArgs === null
      ? row.additionalArgs
      : launchAdditions(row.defaultArgs, row.effectiveArgs),
  );
  const [draft, setDraft] = useState(stored);
  useEffect(() => setDraft(stored), [stored]);
  let args: string[] = [],
    error: string | undefined;
  try {
    args = parseLaunchArgs(draft);
  } catch (e) {
    error = e instanceof Error ? e.message : "参数格式错误";
  }
  const dirty = (error ? draft : formatLaunchArgs(args)) !== stored;
  const fixed = [
    ...Object.entries(row.managedLaunch.environment).map(
      ([key, value]) => `环境变量：${key}=${value}`,
    ),
    formatLaunchArgs(row.defaultArgs),
    formatLaunchArgs(row.managedLaunch.args),
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="rah-runtime-launch-editor">
      <strong>固定启动配置（只读）</strong>
      <pre
        className="rah-runtime-launch-fixed"
        aria-label={`${row.runtimeId} 固定启动配置`}
      >
        {fixed}
      </pre>
      <div className="rah-runtime-launch-heading">
        <strong>附加参数</strong>
        <small>{dirty ? "未保存" : ""}</small>
      </div>
      <div className="rah-runtime-launch-frame">
        <textarea
          aria-label={`${row.runtimeId} 附加参数`}
          value={draft}
          disabled={busy}
          maxLength={8192}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          spellCheck={false}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {row.overrideArgs !== null ? (
        <small>
          此配置来自旧覆盖模式；保存后使用上方固定配置并保留附加参数。
        </small>
      ) : null}
      <small className="rah-runtime-launch-hint">
        保存后下次启动生效；含空格的值用双引号。模型与会话由 Agent 配置决定。
      </small>
      <div className="rah-runtime-launch-actions">
        <button
          className="btn"
          type="button"
          disabled={busy || !!error || (!dirty && row.overrideArgs === null)}
          onClick={() => void onSave(args)}
        >
          保存
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy || !draft}
          onClick={() => setDraft("")}
        >
          清空附加参数
        </button>
      </div>
    </div>
  );
}
