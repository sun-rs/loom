import type { EnvironmentRow } from "./runtime-environment-editor.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export const providerKeys = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"];

/** Provider overrides use the existing per-Agent launch environment owner. */
export function AgentProviderEditor({
  runtimeId,
  rows,
  onChange,
  disabled,
}: {
  runtimeId: string | undefined;
  rows: EnvironmentRow[];
  onChange: (rows: EnvironmentRow[]) => void;
  disabled: boolean;
}) {
  if (runtimeId !== "claude") return null;
  const custom = rows.some((row) => providerKeys.includes(row.key));
  function setValue(key: string, value: string) {
    onChange([...rows.filter((row) => row.key !== key), { key, value }]);
  }
  return (
    <div className="rah-agent-provider-editor">
      <label>
        提供方
        <span className="rah-create-agent-select">
          <select
            aria-label="提供方"
            disabled={disabled}
            value={custom ? "custom" : "default"}
            onChange={(event) =>
              onChange([
                ...rows.filter((row) => !providerKeys.includes(row.key)),
                ...(event.target.value === "custom"
                  ? providerKeys.map((key) => ({ key, value: "" }))
                  : []),
              ])
            }
          >
            <option value="default">默认</option>
            <option value="custom">自定义</option>
          </select>
          <Icon name="chevron-down" />
        </span>
      </label>
      {custom && (
        <>
          <label>
            API 地址
            <input
              type="url"
              required
              disabled={disabled}
              value={
                rows.find((row) => row.key === providerKeys[0])?.value ?? ""
              }
              onChange={(event) =>
                setValue(providerKeys[0]!, event.target.value)
              }
            />
          </label>
          <label>
            API 密钥
            <input
              type="password"
              autoComplete="off"
              required
              disabled={disabled}
              value={
                rows.find((row) => row.key === providerKeys[1])?.value ?? ""
              }
              onChange={(event) =>
                setValue(providerKeys[1]!, event.target.value)
              }
            />
          </label>
        </>
      )}
    </div>
  );
}
