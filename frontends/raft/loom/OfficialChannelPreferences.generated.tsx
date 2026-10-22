// GENERATED from db5e399 ChannelPreferencesSection; native JSX, Loom pinned authority callback.
import {useCallback} from "react";
import {useIntl} from "react-intl";
import {FormSection,Separator,Switch} from "raft-ui";
export const ROW_TITLE_CLASS = "text-subhead font-medium text-foreground";
export const ROW_DESCRIPTION_CLASS = "mt-0.5 text-footnote text-foreground-hint";
export interface ChannelPreferencesSectionProps {
  pin: { pinned: boolean; busy: boolean; onToggle: () => void };
  /** Mute is a panel-only surface; callers without the capability omit it. */
  isPanel?: boolean;
  activityMute?: {
    muted: boolean;
    busy: boolean;
    onToggle: () => void;
  };
  collapseLongMessages?: {
    enabled: boolean;
    busy: boolean;
    onToggle: () => void;
  };
}
export function ChannelPreferencesSection({
  pin,
  isPanel = false,
  activityMute,
  collapseLongMessages,
}: ChannelPreferencesSectionProps) {
  const { formatMessage } = useIntl();
  const isPinned = pin.pinned;
  const handleTogglePin = pin.onToggle;
  // The Switch passes the next checked state; the toggles take no argument.
  const toggleMute = activityMute?.onToggle;
  const handleToggleMute = useCallback(() => toggleMute?.(), [toggleMute]);
  const toggleCollapse = collapseLongMessages?.onToggle;
  const handleToggleCollapse = useCallback(() => toggleCollapse?.(), [toggleCollapse]);

  return (
    <FormSection
      data-testid="channel-settings-preferences"
      title={formatMessage({ id: "message.chatPanel.overflow.preferencesGroup" })}
    >
      <div>
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <h4 id="channel-settings-pin-label" className={ROW_TITLE_CLASS}>
              {formatMessage({ id: "message.channelSettings.pinTitle" })}
            </h4>
            <p className={ROW_DESCRIPTION_CLASS}>
              {formatMessage({ id: "message.channelSettings.pinDescription" })}
            </p>
          </div>
          <Switch
            checked={isPinned}
            disabled={pin.busy}
            onCheckedChange={handleTogglePin}
            aria-labelledby="channel-settings-pin-label"
            className="shrink-0"
            data-testid="channel-settings-pin-switch"
          />
        </div>
        {isPanel && activityMute && (
          <>
          <Separator />
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <h4 id="channel-settings-mute-label" className={ROW_TITLE_CLASS}>
                {formatMessage({ id: "message.channelSettings.muteActivityTitle" })}
              </h4>
              <p className={ROW_DESCRIPTION_CLASS}>
                {formatMessage({ id: "message.channelSettings.muteActivityDescription" })}
              </p>
            </div>
            <Switch
              checked={activityMute.muted}
              disabled={activityMute.busy}
              onCheckedChange={handleToggleMute}
              aria-labelledby="channel-settings-mute-label"
              className="shrink-0"
              data-testid="channel-overflow-mute-switch"
            />
          </div>
          </>
        )}
        {collapseLongMessages && (
          <>
          <Separator />
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <h4 id="channel-settings-collapse-label" className={ROW_TITLE_CLASS}>
                {formatMessage({ id: "message.channelSettings.collapseLongMessagesTitle" })}
              </h4>
              <p className={ROW_DESCRIPTION_CLASS}>
                {formatMessage({ id: "message.channelSettings.collapseLongMessagesDescription" })}
              </p>
            </div>
            <Switch
              checked={collapseLongMessages.enabled}
              disabled={collapseLongMessages.busy}
              onCheckedChange={handleToggleCollapse}
              aria-labelledby="channel-settings-collapse-label"
              className="shrink-0"
              data-testid="channel-settings-collapse-switch"
            />
          </div>
          </>
        )}
      </div>
    </FormSection>
  );
}
