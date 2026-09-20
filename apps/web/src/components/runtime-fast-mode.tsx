import { useId } from "react";

/** Shared Raft option-card presentation; caller owns service-tier selection. */
export function RuntimeFastMode({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="rah-runtime-fast-mode">
      <span className="rah-runtime-fast-check">
        <input
          type="checkbox"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <b id={`${id}-title`}>快速模式</b>
      <span id={`${id}-description`}>
        以更高的单 token 成本换取更快速度启动此运行时。
      </span>
    </label>
  );
}
