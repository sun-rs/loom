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
    enabled: boolean,
  ) {
    if (!data || writing.current) return;
    const ticket = ++generation.current;
    writing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const value = await client.request("runtime.guide.update", {
        runtimeId,
        enabled,
        expectedRevision: data.revision,
      });
      if (generation.current === ticket) setData(value);
    } catch (failure) {
      if (generation.current !== ticket) return;
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
  }
  return (
    <div className="rah-runtime-settings">
      <header className="rah-runtime-settings-intro">
        <h2>忙时消息投递</h2>
        <p>勾选开启忙时投递；关闭时等待本轮结束。灰色表示暂不支持。</p>
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
            <div className="rah-runtime-settings-heading">
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
                <small>{presentation[row.runtimeId].mode}</small>
              </div>
              <label className="rah-settings-check-row rah-runtime-settings-control">
                <input
                  type="checkbox"
                  aria-label={`${labels[row.runtimeId]} Guide`}
                  checked={row.enabled}
                  disabled={busy || !row.supported}
                  onChange={(event) =>
                    void update(row.runtimeId, event.target.checked)
                  }
                />
              </label>
            </div>
          </section>
        ))}
      </div>

      {busy ? <p role="status">正在保存…</p> : null}
    </div>
  );
}
