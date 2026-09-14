import {
  RuntimeEnvironmentEditor,
  type EnvironmentRow,
} from "./runtime-environment-editor.tsx";
import { RuntimeLaunchEnvironmentSchema } from "@rah-os/protocol";
import { useEffect, useState } from "react";
import type { RuntimeGuideSettingsView } from "@rah-os/protocol";
import {
  formatLaunchArgs,
  parseLaunchArgs,
} from "../runtime-launch-editor-model.ts";
type Row = RuntimeGuideSettingsView["runtimes"][number];
export function RuntimeLaunchEditor({
  row,
  busy,
  onSave,
}: {
  row: Row;
  busy: boolean;
  onSave: (
    args: string[],
    environment: Record<string, string>,
  ) => Promise<boolean>;
}) {
  const stored = formatLaunchArgs(row.additionalArgs);
  const [draft, setDraft] = useState(stored);
  const [envRows, setEnvRows] = useState<EnvironmentRow[]>(
    Object.entries(row.environment ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
  );
  const storedEnvironment = JSON.stringify(row.environment ?? {});
  useEffect(
    () =>
      setEnvRows(
        Object.entries(
          JSON.parse(storedEnvironment) as Record<string, string>,
        ).map(([key, value]) => ({ key, value })),
      ),
    [storedEnvironment],
  );
  let environment: Record<string, string> = Object.create(null);

  useEffect(() => setDraft(stored), [stored]);
  let args: string[] = [],
    error: string | undefined;
  try {
    args = parseLaunchArgs(draft);
    for (const item of envRows) {
      if (!item.key && !item.value) continue;
      if (Object.hasOwn(environment, item.key))
        throw new Error("环境变量名称重复：" + item.key);
      environment[item.key] = item.value;
    }
    environment = RuntimeLaunchEnvironmentSchema.parse(environment);
  } catch (e) {
    error = e instanceof Error ? e.message : "参数格式错误";
  }
  const dirty =
    (error ? draft : formatLaunchArgs(args)) !== stored ||
    JSON.stringify(environment) !== storedEnvironment;
  return (
    <div className="rah-runtime-launch-editor">
      <RuntimeEnvironmentEditor
        rows={envRows}
        disabled={busy}
        onChange={setEnvRows}
      />
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
      <small className="rah-runtime-launch-hint">
        保存后下次启动生效；含空格的值用双引号。相同完整参数项会去重，同名参数值冲突时需调整配置。模型与会话由
        Agent 配置决定。
      </small>
      <div className="rah-runtime-launch-actions">
        <button
          className="btn"
          type="button"
          disabled={busy || !!error || !dirty}
          onClick={() => void onSave(args, environment)}
        >
          保存启动配置
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
