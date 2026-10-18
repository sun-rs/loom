// Mode selector structurally retained from the official picker; removed family selection for rUI 0.6.
import { useIntl } from "react-intl";
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
import type { AppearanceMode } from "../../../../../loom/theme-mode";
export function AppearanceThemePicker({
  mode,
  onModeChange,
}: {
  mode: AppearanceMode;
  onModeChange: (mode: AppearanceMode) => void;
}) {
  const { formatMessage } = useIntl();
  const labels = {
    light: "settings.appearance.modeLight",
    dark: "settings.appearance.modeDark",
    system: "settings.appearance.modeSystem",
  };
  return (
    <div data-testid="appearance-theme-picker">
      <SegmentedControl<AppearanceMode>
        value={mode}
        onValueChange={onModeChange}
        aria-label={formatMessage({ id: "settings.appearance.modeAria" })}
        className="w-fit max-w-full"
      >
        {(["light", "dark", "system"] as const).map((value) => (
          <SegmentedControlItem
            key={value}
            value={value}
            data-testid={`appearance-mode-${value}`}
          >
            <SegmentedControlLabel>
              {formatMessage({ id: labels[value] })}
            </SegmentedControlLabel>
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  );
}

export default AppearanceThemePicker;
