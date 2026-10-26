import type { ReactElement } from "react";
export function OfficialThemeOption(props: {
  theme: string;
  mode: "light" | "dark";
  label: string;
  selected: boolean;
  hint?: string | null;
  proBadge?: string | null;
  onSelect: (theme: string) => void;
}): ReactElement;
