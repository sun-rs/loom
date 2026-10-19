// Raft LanguageRegionSection date form structural port; v1.21.22 Card/typography recipe.
// Translation/cloud controls omitted; owner scope is Chinese-only device presentation.
import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Clock, Languages, Check } from "lucide-react";
import {
  Card,
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectList,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
import Banner from "../packages/web/src/components/ui/Banner.tsx";
import SectionHeader from "../packages/web/src/components/ui/SectionHeader.tsx";
import {
  useTranslationStore,
  getTimezoneOptions,
} from "../packages/web/src/store/translationStore.ts";
import { saveDeviceRegion } from "./region-runtime.ts";
export default function LanguageRegionSettings() {
  const { formatMessage } = useIntl();
  const settings = useTranslationStore((s) => s.settings);
  const [timezone, setTimezone] = useState(settings.preferredTimezone ?? "");
  const [timeFormat, setTimeFormat] = useState<"12h" | "24h">(
    settings.effectiveTimeFormat,
  );
  const [error, setError] = useState(""),
    [dateTimeSaved, setSaved] = useState(false);
  const dateTimeDirty =
    timezone !== (settings.preferredTimezone ?? "") ||
    timeFormat !== settings.effectiveTimeFormat;
  const timezoneOptions = getTimezoneOptions(
    settings.effectiveTimezone,
    formatMessage,
  );
  const timezoneMenuOptions = timezoneOptions.filter(
    (option) => option.value !== timezone,
  );
  const renderSelectItems = (options: typeof timezoneOptions) =>
    options.map((option) => (
      <SelectItem key={option.value} value={option.value}>
        <SelectItemText>{option.label}</SelectItemText>
        <SelectItemIndicator />
      </SelectItem>
    ));
  const handleTimezoneChange = (next: string | null) => {
    if (next !== null) setTimezone(next);
    setSaved(false);
    setError("");
  };
  const handleTimeFormatChange = (next: "12h" | "24h") => {
    setTimeFormat(next);
    setSaved(false);
    setError("");
  };
  const handleSaveDateTime = (event: FormEvent) => {
    event.preventDefault();
    if (!dateTimeDirty) return;
    try {
      saveDeviceRegion({ timezone: timezone || null, timeFormat });
      setSaved(true);
      setError("");
    } catch {
      setError("保存失败，请检查浏览器存储权限后重试。");
    }
  };
  return (
    <>
      <div className="mb-6">
        <SectionHeader
          className="mb-3"
          icon={<Languages size={16} />}
          label={formatMessage({ id: "settings.language.sectionLabel" })}
        />
        <Card className="block space-y-4 p-4">
          <div className="space-y-3">
            <div>
              <div className="text-subhead font-semibold text-foreground">
                显示语言
              </div>
              <div className="text-footnote text-foreground-muted mt-0.5">
                界面使用简体中文。日期与时间设置仅保存在此浏览器。
              </div>
            </div>
            <Select
              value="zh-cn"
              disabled
              items={[{ value: "zh-cn", label: "简体中文" }]}
            >
              <SelectTrigger
                className="w-full max-w-sm"
                data-testid="display-language-select"
              >
                <SelectValue />
                <SelectIcon />
              </SelectTrigger>
            </Select>
          </div>
        </Card>
      </div>
      <div className="mb-6">
        <SectionHeader
          className="mb-3"
          icon={<Clock size={16} />}
          label={formatMessage({ id: "settings.dateTime.sectionLabel" })}
        />

        <Card
          render={<form onSubmit={handleSaveDateTime} />}
          className="block space-y-4 p-4"
          data-testid="region-date-form"
        >
          <div className="space-y-3">
            <div>
              <div className="text-subhead font-semibold text-foreground">
                {formatMessage({ id: "settings.dateTime.timezone" })}
              </div>
              <div className="text-footnote text-foreground-muted mt-0.5">
                {formatMessage({ id: "settings.dateTime.timezoneDesc" })}
              </div>
            </div>
            <Select
              value={timezone}
              onValueChange={handleTimezoneChange}
              items={timezoneOptions}
            >
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder={timezoneOptions[0]?.label} />
                <SelectIcon />
              </SelectTrigger>
              <SelectContent>
                <SelectList>
                  {renderSelectItems(timezoneMenuOptions)}
                </SelectList>
              </SelectContent>
            </Select>
            <div>
              <div className="text-subhead font-semibold text-foreground">
                {formatMessage({ id: "settings.dateTime.timeFormat" })}
              </div>
              <div className="text-footnote text-foreground-muted mt-0.5">
                {formatMessage({ id: "settings.dateTime.timeFormatDesc" })}
              </div>
            </div>
            <SegmentedControl<"12h" | "24h">
              value={timeFormat}
              aria-label={formatMessage({
                id: "settings.dateTime.timeFormatAria",
              })}
              onValueChange={handleTimeFormatChange}
            >
              <SegmentedControlItem value="12h" data-testid="time-format-12h">
                <SegmentedControlLabel>
                  {formatMessage({ id: "settings.dateTime.formatTwelveHour" })}
                </SegmentedControlLabel>
              </SegmentedControlItem>
              <SegmentedControlItem value="24h" data-testid="time-format-24h">
                <SegmentedControlLabel>
                  {formatMessage({
                    id: "settings.dateTime.formatTwentyFourHour",
                  })}
                </SegmentedControlLabel>
              </SegmentedControlItem>
            </SegmentedControl>
          </div>

          {error && (
            <Banner intent="warning" density="sm">
              {error}
            </Banner>
          )}
          <Button
            variant="accent"
            size="sm"
            type="submit"
            disabled={!dateTimeDirty}
            className="flex items-center gap-1.5"
          >
            {dateTimeSaved ? (
              <>
                <Check size={14} />{" "}
                {formatMessage({ id: "settings.common.saved" })}
              </>
            ) : (
              formatMessage({ id: "settings.common.save" })
            )}
          </Button>
        </Card>
      </div>
    </>
  );
}
