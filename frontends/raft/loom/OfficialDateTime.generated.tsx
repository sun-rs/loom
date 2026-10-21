// GENERATED exact official date/time JSX; local props own device persistence. Do not edit.
import type {FormEvent,ReactNode} from 'react';
import type {IntlShape} from 'react-intl';
import {Clock,Check} from 'lucide-react';
import {Card,Button,Select,SelectTrigger,SelectValue,SelectIcon,SelectContent,SelectList,SegmentedControl,SegmentedControlItem,SegmentedControlLabel} from 'raft-ui';
import SectionHeader from '@loom/raft-web-source/SectionHeader';
import Banner from '../packages/web/src/components/ui/Banner';
type Option={value:string;label:string};
type Props={formatMessage:IntlShape['formatMessage'];timezone:string;timeFormat:'12h'|'24h';timezoneOptions:Option[];timezoneMenuOptions:Option[];renderSelectItems:(options:Option[])=>ReactNode;handleTimezoneChange:(next:string|null)=>void;handleTimeFormatChange:(next:'12h'|'24h')=>void;handleSaveDateTime:(event:FormEvent)=>void;dateTimeDirty:boolean;dateTimeSaved:boolean;settingsError:string;timezoneError:string;timeFormatError:string;savingDateTime:boolean;settingsLoading:boolean};
export default function OfficialDateTime({formatMessage,timezone,timeFormat,timezoneOptions,timezoneMenuOptions,renderSelectItems,handleTimezoneChange,handleTimeFormatChange,handleSaveDateTime,dateTimeDirty,dateTimeSaved,settingsError,timezoneError,timeFormatError,savingDateTime,settingsLoading}:Props){return (<div className="mb-6">
        <SectionHeader
          className="mb-3"
          icon={<Clock size={16} />}
          label={formatMessage({ id: "settings.dateTime.sectionLabel" })}
        />

        <Card render={<form onSubmit={handleSaveDateTime} />} className="block space-y-4 p-4">
          <div className="space-y-3">
            <div>
              <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.dateTime.timezone" })}</div>
              <div className="text-footnote text-foreground-muted mt-0.5">
                {formatMessage({ id: "settings.dateTime.timezoneDesc" })}
              </div>
            </div>
            <Select
              value={timezone}
              onValueChange={handleTimezoneChange}
              disabled={savingDateTime || settingsLoading}
              items={timezoneOptions}
            >
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder={formatMessage({ id: "settings.dateTime.timezonePlaceholder" })} />
                <SelectIcon />
              </SelectTrigger>
              <SelectContent>
                <SelectList>
                  {renderSelectItems(timezoneMenuOptions)}
                </SelectList>
              </SelectContent>
            </Select>
            <div>
              <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.dateTime.timeFormat" })}</div>
              <div className="text-footnote text-foreground-muted mt-0.5">
                {formatMessage({ id: "settings.dateTime.timeFormatDesc" })}
              </div>
            </div>
            <SegmentedControl<"12h" | "24h">
              value={timeFormat}
              aria-label={formatMessage({ id: "settings.dateTime.timeFormatAria" })}
              onValueChange={handleTimeFormatChange}
              disabled={savingDateTime || settingsLoading}
            >
              <SegmentedControlItem value="12h" data-testid="time-format-12h">
                <SegmentedControlLabel>{formatMessage({ id: "settings.dateTime.formatTwelveHour" })}</SegmentedControlLabel>
              </SegmentedControlItem>
              <SegmentedControlItem value="24h" data-testid="time-format-24h">
                <SegmentedControlLabel>{formatMessage({ id: "settings.dateTime.formatTwentyFourHour" })}</SegmentedControlLabel>
              </SegmentedControlItem>
            </SegmentedControl>
          </div>

          {(settingsError || timezoneError || timeFormatError) && (
            <Banner intent="warning" density="sm">
              {timezoneError || timeFormatError || settingsError}
            </Banner>
          )}
          <Button
            variant="accent" size="sm"
            type="submit"
            disabled={!dateTimeDirty || savingDateTime || settingsLoading}
            className="flex items-center gap-1.5"
          >
            {savingDateTime ? formatMessage({ id: "settings.common.saving" }) : dateTimeSaved ? (
              <><Check size={14} /> {formatMessage({ id: "settings.common.saved" })}</>
            ) : formatMessage({ id: "settings.common.save" })}
          </Button>
        </Card>
      </div>);}
