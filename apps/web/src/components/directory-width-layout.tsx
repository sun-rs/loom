import { usePanelResize } from "@rah-os/ui-web/neo-brutalist/panel-resizer";
import {
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import {
  RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH,
  RAFT_COMPUTER_SIDEBAR_MIN_WIDTH,
  RAFT_COMPUTER_SIDEBAR_MAX_WIDTH,
  nextComputerSidebarWidth,
  readComputerSidebarWidth,
  writeComputerSidebarWidth,
} from "../computer-sidebar-resize.ts";

type Kind = "agents" | "computers" | "files";
const policies = {
  agents: {
    initial: 240,
    min: 180,
    max: 320,
    step: 8,
    className: "rah-agent-sidebar-resizer",
    label: "调整成员边栏宽度",
  },
  computers: {
    initial: RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH,
    min: RAFT_COMPUTER_SIDEBAR_MIN_WIDTH,
    max: RAFT_COMPUTER_SIDEBAR_MAX_WIDTH,
    step: 8,
    className: "rah-computer-sidebar-resizer",
    label: "调整计算机边栏宽度",
  },
  files: {
    initial: 256,
    min: 160,
    max: 600,
    step: 16,
    className: "rah-workspace-resizer",
    label: "调整文件树宽度",
  },
};
const Width = createContext<{
  kind: Kind;
  width: number;
  setWidth: (width: number) => void;
} | null>(null);
/** Existing directory geometry and persistence, isolated from its stable content.
 * No navigation, data or file selection state belongs to this owner. */
export function DirectoryWidthLayout({
  kind,
  as: Tag = "main",
  children,
  style,
  ...props
}: HTMLAttributes<HTMLElement> & { kind: Kind; as?: "main" | "section" }) {
  const [width, setWidth] = useState(() =>
    kind === "computers"
      ? readComputerSidebarWidth(window.localStorage)
      : policies[kind].initial,
  );
  const widthStyles = {
    agents: { "--rah-agent-sidebar-width": `${width}px` },
    computers: { "--rah-computer-sidebar-width": `${width}px` },
    files: { "--rah-tree-width": `${width}px` },
  };
  return (
    <Width.Provider value={{ kind, width, setWidth }}>
      <Tag
        {...props}
        style={{ ...style, ...widthStyles[kind] } as CSSProperties}
      >
        {children}
      </Tag>
    </Width.Provider>
  );
}
/** Structural extraction of the existing directory grips. Preserve each family's
 * CSS, key step and commit-only Computer preference instead of changing UX. */
export function DirectoryWidthResizer() {
  const state = useContext(Width);
  if (!state) throw new Error("Directory grip requires width owner");
  const { kind, width, setWidth } = state,
    policy = policies[kind];
  const { dragging, ...handlers } = usePanelResize({
    width,
    onWidthChange: setWidth,
    direction: 1,
    preventSelection: kind !== "agents",
    clamp: (value) => Math.max(policy.min, Math.min(policy.max, value)),
    onWidthCommit:
      kind === "computers"
        ? (value) => writeComputerSidebarWidth(window.localStorage, value)
        : undefined,
    nextWidth: (current, key, shift) => {
      if (kind === "computers") return nextComputerSidebarWidth(current, key);
      if (!["Home", "End", "ArrowLeft", "ArrowRight"].includes(key)) return;
      const step = kind === "agents" && shift ? 32 : policy.step;
      return key === "Home"
        ? policy.min
        : key === "End"
          ? policy.max
          : Math.max(
              policy.min,
              Math.min(
                policy.max,
                current + (key === "ArrowLeft" ? -step : step),
              ),
            );
    },
  });
  return (
    <div
      aria-label={policy.label}
      aria-orientation="vertical"
      aria-valuemin={policy.min}
      aria-valuemax={policy.max}
      aria-valuenow={width}
      className={`${policy.className}${dragging && kind !== "files" ? " is-dragging" : ""}`}
      role="separator"
      tabIndex={0}
      {...handlers}
    />
  );
}
