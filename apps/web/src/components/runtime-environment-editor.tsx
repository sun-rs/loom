import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
export type EnvironmentRow = { key: string; value: string };
export function RuntimeEnvironmentEditor({
  rows,
  disabled,
  onChange,
}: {
  rows: EnvironmentRow[];
  disabled: boolean;
  onChange: (rows: EnvironmentRow[]) => void;
}) {
  return (
    <div className="rah-runtime-environment-editor">
      <div>
        <strong>环境变量</strong>
        <p className="rah-runtime-environment-description">
          环境变量会注入到 Agent 运行时中。
        </p>
      </div>
      {rows.map((row, index) => (
        <div className="rah-runtime-environment-row" key={index}>
          <input
            aria-label={`环境变量名称 ${index + 1}`}
            placeholder="KEY"
            value={row.key}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                rows.map((item, i) =>
                  i === index ? { ...item, key: e.target.value } : item,
                ),
              )
            }
          />
          <span aria-hidden="true">=</span>
          <input
            aria-label={`环境变量值 ${index + 1}`}
            placeholder="value"
            value={row.value}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                rows.map((item, i) =>
                  i === index ? { ...item, value: e.target.value } : item,
                ),
              )
            }
          />
          <button
            className="sq-btn"
            type="button"
            aria-label={`删除环境变量 ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Icon name="trash-2" />
          </button>
        </div>
      ))}
      <button
        className="rah-runtime-environment-add"
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Icon name="plus" /> 添加变量
      </button>
    </div>
  );
}
