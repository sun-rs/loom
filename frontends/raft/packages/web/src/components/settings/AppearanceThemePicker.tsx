// Structural port of Raft v1.21.22 Yut / Xut / v8, revision af3d6ef.
// Source and retained license: frontends/raft/page-adoption.json and LICENSE.
import { useIntl } from "react-intl";
import { Card, RadioGroup, RadioGroupItem } from "raft-ui";
import { Check } from "lucide-react";
import type { AppearanceMode } from "../../../../../loom/theme-mode";
export function AppearanceThemePicker({
  mode,
  onModeChange,
  size = "default",
}: {
  mode: AppearanceMode;
  onModeChange: (mode: AppearanceMode) => void;
  size?: "default" | "large";
}) {
  const { formatMessage } = useIntl();
  const modes = ["light", "dark", "system"] as const;
  const labels = {
    light: "settings.appearance.modeLight",
    dark: "settings.appearance.modeDark",
    system: "settings.appearance.modeSystem",
  };
  return (
    <RadioGroup
      value={mode}
      onValueChange={(value) => {
        if (modes.includes(value as AppearanceMode))
          onModeChange(value as AppearanceMode);
      }}
      aria-label={formatMessage({ id: "settings.appearance.themeAria" })}
      className={
        size === "large"
          ? "grid grid-cols-1 gap-3 sm:grid-cols-3"
          : "grid grid-cols-1 gap-2 sm:grid-cols-3"
      }
      data-testid="appearance-theme-picker"
    >
      {modes.map((value) => (
        <div
          key={value}
          className="group min-w-0"
          data-testid={`appearance-theme-${value}`}
        >
          <RadioGroupItem
            appearance="none"
            value={value}
            aria-label={formatMessage({ id: labels[value] })}
            className="peer"
          />
          <Card
            onClick={() => onModeChange(value)}
            data-testid={`appearance-mode-${value}`}
            className="h-full gap-2 p-2 hover:press-overlay peer-focus-visible:shadow-raft-focus peer-data-checked:border-[1.5px] peer-data-checked:border-line-strong peer-data-checked:p-[7.5px]"
          >
            {value === "system" ? (
              <div className="relative" aria-hidden="true">
                <ThemePreview mode="light" size={size} />
                <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                  <ThemePreview mode="dark" size={size} />
                </div>
              </div>
            ) : (
              <ThemePreview mode={value} size={size} />
            )}
            <div className="flex min-w-0 items-center gap-2 px-1">
              <span className="min-w-0 flex-1 truncate text-callout font-semibold text-foreground">
                {formatMessage({ id: labels[value] })}
              </span>
              {mode === value ? (
                <Check
                  size={16}
                  className="shrink-0 text-foreground"
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <span className="min-h-4 px-1 text-caption text-foreground-hint">
              {mode === value
                ? formatMessage({ id: "settings.appearance.savedOnDevice" })
                : null}
            </span>
          </Card>
        </div>
      ))}
    </RadioGroup>
  );
}
function ThemePreview({
  mode,
  size,
}: {
  mode: "light" | "dark";
  size: "default" | "large";
}) {
  return (
    <div
      className={`${mode} flex overflow-hidden rounded-control border border-line-seam bg-layer-panel ${size === "large" ? "h-28" : "h-20"}`}
      aria-hidden="true"
    >
      <div className="w-3 shrink-0 border-r border-line-seam bg-layer-frame" />
      <div className="flex w-1/3 shrink-0 flex-col gap-1 border-r border-line-seam bg-layer-canvas-muted p-1.5">
        <div className="h-1.5 w-3/4 rounded-[2px] bg-foreground/30" />
        <div className="h-3 rounded-[3px] border border-sticker-ink bg-primary" />
        <div className="h-1.5 w-2/3 rounded-[2px] bg-foreground/15" />
        <div className="h-1.5 w-1/2 rounded-[2px] bg-foreground/15" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
        <div className="h-1.5 w-1/2 rounded-[2px] bg-foreground/40" />
        <div className="flex items-center gap-1.5">
          <div className="size-3 shrink-0 rounded-[2px] border border-sticker-ink bg-brutal-lavender" />
          <div className="h-1.5 flex-1 rounded-[2px] bg-foreground/15" />
        </div>
        <div className="mt-auto flex items-center gap-1.5 rounded-[4px] border border-line-strong bg-layer-card p-1">
          <div className="h-1.5 flex-1 rounded-[2px] bg-foreground/15" />
          <div className="h-3 w-6 shrink-0 rounded-[3px] border border-sticker-ink bg-accent" />
        </div>
      </div>
    </div>
  );
}
export default AppearanceThemePicker;
