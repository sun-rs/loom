import { LoadingState } from "@rah-os/ui-web/neo-brutalist/loading-state";
import { formatLaunchArgs } from "../runtime-launch-editor-model.ts";
import codexIcon from "@rah-os/ui-tokens/runtime-icons/codex.svg";
import claudeIcon from "@rah-os/ui-tokens/runtime-icons/claude.svg";
import kimiIcon from "@rah-os/ui-tokens/runtime-icons/kimi.svg";
import opencodeIcon from "@rah-os/ui-tokens/runtime-icons/opencode.svg";
import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { RuntimeGuideSettingsView } from "@rah-os/protocol";

const labels = {
  codex: "Codex",
  claude: "Claude Code",
  kimi: "Kimi",
  opencode: "OpenCode",
};

const presentation = {
  codex: { icon: codexIcon, mode: "原生追加" },
  claude: { icon: claudeIcon, mode: "工具间隙追加" },
  kimi: { icon: kimiIcon, mode: "暂不支持" },
  opencode: { icon: opencodeIcon, mode: "暂不支持" },
};

export function RuntimeGuideSettingsContent({ client }: { client: RahClient }) {
  const [data, setData] = useState<RuntimeGuideSettingsView>();
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ticket = ++generation.current;
    writing.current = false;
    setBusy(false);
    setData(undefined);
    setError(undefined);
    client
      .request("runtime.guide.read", {})
      .then((value) => {
        if (generation.current === ticket) setData(value);
      })
      .catch((failure) => {
        if (generation.current === ticket) setError(String(failure));
      });
    return () => {
      generation.current++;
    };
  }, [client]);
  async function updateGuide(
    runtimeId: RuntimeGuideSettingsView["runtimes"][number]["runtimeId"],
    enabled: boolean,
  ) {
    if (!data || writing.current) return;
    const ticket = generation.current;
    writing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const next = await client.request("runtime.guide.update", {
        runtimeId,
        enabled,
        expectedRevision: data.revision,
      });
      if (generation.current === ticket) setData(next);
    } catch (failure) {
      if (generation.current !== ticket) return;
      setError(`保存失败，请重新确认设置：${String(failure)}`);
      try {
        const next = await client.request("runtime.guide.read", {});
        if (generation.current === ticket) setData(next);
      } catch {
        if (generation.current === ticket) setData(undefined);
      }
    } finally {
      if (generation.current === ticket) {
        writing.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div className="rah-runtime-settings">
      <header className="rah-runtime-settings-intro">
        <h2>CLI 启动信息</h2>
        <p>
          此处展示系统固定启动配置。单个 Agent
          的附加参数和环境变量请在其运行时配置中编辑。
        </p>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!data && !error ? <LoadingState /> : null}
      <div className="rah-runtime-settings-list">
        {data?.runtimes.map((row) => (
          <section
            className="rah-runtime-settings-card"
            key={row.runtimeId}
            aria-label={labels[row.runtimeId]}
            data-supported={row.supported}
          >
            <details className="rah-runtime-provider-details" open>
              <summary className="rah-runtime-settings-heading">
                <span
                  className="rah-runtime-settings-icon"
                  data-runtime={row.runtimeId}
                >
                  <img
                    src={presentation[row.runtimeId].icon}
                    alt=""
                    aria-hidden="true"
                  />
                </span>
                <div className="rah-runtime-settings-name">
                  <h3>{labels[row.runtimeId]}</h3>
                </div>
                <span className="rah-runtime-disclosure" aria-hidden="true" />
              </summary>
              <div className="rah-runtime-provider-body">
                <label className="rah-settings-check-row rah-runtime-guide-row">
                  <span>
                    忙时投递{" "}
                    <small>
                      {row.supported
                        ? `${presentation[row.runtimeId].mode}；关闭时等本轮结束`
                        : "此 CLI 暂不支持"}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    aria-label={`${labels[row.runtimeId]} Guide`}
                    checked={row.enabled}
                    disabled={busy || !row.supported}
                    onChange={(event) =>
                      void updateGuide(row.runtimeId, event.target.checked)
                    }
                  />
                </label>
                <div className="rah-runtime-launch-field">
                  <strong>系统启动命令</strong>
                  <pre
                    className="rah-runtime-launch-fixed"
                    aria-label={`${row.runtimeId} 系统启动命令`}
                  >
                    {formatLaunchArgs([
                      row.runtimeId,
                      ...row.defaultArgs,
                      ...row.managedLaunch.args,
                    ])}
                  </pre>
                </div>
                {Object.keys(row.managedLaunch.environment).length > 0 && (
                  <div className="rah-runtime-launch-field">
                    <strong>系统环境变量</strong>
                    <pre
                      className="rah-runtime-launch-fixed"
                      aria-label={`${row.runtimeId} 系统环境变量`}
                    >
                      {Object.entries(row.managedLaunch.environment)
                        .map(([key, value]) => `${key}=${value}`)
                        .join("\n")}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          </section>
        ))}
      </div>
    </div>
  );
}
