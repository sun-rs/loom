import { RuntimeLaunchEditor } from "./runtime-launch-editor.tsx";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    const ticket = ++generation.current;
    setData(undefined);
    setError(undefined);
    writing.current = false;
    setBusy(false);
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
  async function update(
    runtimeId: RuntimeGuideSettingsView["runtimes"][number]["runtimeId"],
    change: { enabled?: boolean; additionalArgs?: string[] },
  ) {
    if (!data || writing.current) return false;
    const ticket = ++generation.current;
    writing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const value = await client.request("runtime.guide.update", {
        runtimeId,
        ...change,
        expectedRevision: data.revision,
      });
      if (generation.current === ticket) {
        setData(value);
        return true;
      }
    } catch (failure) {
      if (generation.current !== ticket) return false;
      setError(`保存失败，请重新确认设置：${String(failure)}`);
      try {
        const value = await client.request("runtime.guide.read", {});
        if (generation.current === ticket) setData(value);
      } catch {
        if (generation.current === ticket) setData(undefined);
      }
    } finally {
      if (generation.current === ticket) {
        writing.current = false;
        setBusy(false);
      }
    }
    return false;
  }
  return (
    <div className="rah-runtime-settings">
      <header className="rah-runtime-settings-intro">
        <h2>CLI 配置</h2>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!data && !error ? <p role="status">正在读取设置…</p> : null}
      <div className="rah-runtime-settings-list">
        {data?.runtimes.map((row) => (
          <section
            className="rah-runtime-settings-card"
            key={row.runtimeId}
            aria-label={labels[row.runtimeId]}
            data-supported={row.supported}
          >
            <details className="rah-runtime-provider-details">
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
                      void update(row.runtimeId, {
                        enabled: event.target.checked,
                      })
                    }
                  />
                </label>
                <RuntimeLaunchEditor
                  row={row}
                  busy={busy}
                  onSave={(additionalArgs) =>
                    update(row.runtimeId, { additionalArgs })
                  }
                />
              </div>
            </details>
          </section>
        ))}
      </div>

      {busy ? <p role="status">正在保存…</p> : null}
    </div>
  );
}
