// Official date/time JSX with local synchronous device persistence.
// Translation/cloud controls omitted; owner scope is Chinese-only device presentation.
import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Languages } from "lucide-react";
import {
  Card,
  Select,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
} from "raft-ui";
import OfficialDateTime from "./OfficialDateTime.generated.tsx";
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
  ).map((option) => ({ ...option, value: option.value || "browser" }));
  const timezoneMenuOptions = timezoneOptions.filter(
    (option) => option.value !== (timezone || "browser"),
  );
  const renderSelectItems = (options: typeof timezoneOptions) =>
    options.map((option) => (
      <SelectItem key={option.value} value={option.value}>
        <SelectItemText>{option.label}</SelectItemText>
        <SelectItemIndicator />
      </SelectItem>
    ));
  const handleTimezoneChange = (next: string | null) => {
    if (next !== null) setTimezone(next === "browser" ? "" : next);
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
      <div data-testid="region-date-form">
        <OfficialDateTime
          formatMessage={formatMessage}
          timezone={timezone || "browser"}
          timeFormat={timeFormat}
          timezoneOptions={timezoneOptions}
          timezoneMenuOptions={timezoneMenuOptions}
          renderSelectItems={renderSelectItems}
          handleTimezoneChange={handleTimezoneChange}
          handleTimeFormatChange={handleTimeFormatChange}
          handleSaveDateTime={handleSaveDateTime}
          dateTimeDirty={dateTimeDirty}
          dateTimeSaved={dateTimeSaved}
          settingsError={error}
          timezoneError=""
          timeFormatError=""
          savingDateTime={false}
          settingsLoading={false}
        />
      </div>
    </>
  );
}
