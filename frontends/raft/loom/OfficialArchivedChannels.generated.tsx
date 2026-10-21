// GENERATED pinned official presentation. Explicit imports bind Loom state; do not edit.
import {useCallback} from 'react';
import {useIntl} from 'react-intl';
import {Archive,ArchiveRestore,GitBranch,Hash,Lock} from 'lucide-react';
import {Card,IconTile,Button} from 'raft-ui';
import {useTimeFormatter} from '../packages/web/src/hooks/useTimeFormatter';
import Banner from '../packages/web/src/components/ui/Banner';
import SectionHeader from '@loom/raft-web-source/SectionHeader';
import Tooltip from '@loom/raft-web-source/Tooltip';
import {useArchivedSettings} from './ArchivedSettings';
type ArchivedChannel=ReturnType<typeof useArchivedSettings>['archivedChannels'][number];
function channelTypeIcon(type: "channel" | "private" | "joint") {
  if (type === "private") return <Lock size={16} />;
  if (type === "joint") return <GitBranch size={16} />;
  return <Hash size={16} />;
}
export function UnarchiveChannelButton({
  channel,
  busy,
  disabled,
  onUnarchive,
}: {
  channel: ArchivedChannel;
  busy: boolean;
  disabled: boolean;
  onUnarchive: (channel: ArchivedChannel) => Promise<void>;
}) {
  const { formatMessage } = useIntl();
  const handleClick = useCallback(() => void onUnarchive(channel), [onUnarchive, channel]);
  return (
    <Button
      size="sm"
      variant="outline"
      className="w-full sm:w-auto"
      disabled={disabled}
      aria-label={formatMessage(
        { id: "settings.archivedChannels.unarchiveAriaLabel" },
        { name: channel.name },
      )}
      onClick={handleClick}
    >
      <ArchiveRestore size={14} />
      {busy
        ? formatMessage({ id: "channel.edit.unarchiving" })
        : formatMessage({ id: "channel.create.unarchive" })}
    </Button>
  );
}
export default function OfficialArchivedChannels(){const {formatMessage}=useIntl();const {formatMediumDateTime}=useTimeFormatter();const {nav,capabilities,loading,archivedChannels,busyChannelId,error,handleUnarchive}=useArchivedSettings();
if (!capabilities.archiveChannels || loading || archivedChannels.length === 0) {
    return null;
  }
return (
    <section className="mb-6" data-testid="archived-channels-section">
      <SectionHeader
        className="mb-3"
        icon={<Archive size={16} />}
        label={formatMessage({ id: "settings.archivedChannels.sectionLabel" })}
        count={archivedChannels.length}
      />

      {error ? (
        <Banner
          intent="warning"
          density="sm"
          className="mb-3"
          data-testid="archived-channels-error"
        >
          {error}
        </Banner>
      ) : null}

      <Card className="divide-y divide-line-hairline">
        {archivedChannels.map((channel) => {
          const busy = busyChannelId === channel.id;
          const typeLabel = "频道";
          const channelName = formatMessage(
            { id: "settings.archivedChannels.channelName" },
            { name: channel.name },
          );
          return (
            <div
              key={channel.id}
              className="flex flex-col gap-3 px-4 py-3 sm:min-h-11 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`archived-channel-row-${channel.id}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Tooltip content={typeLabel}>
                <IconTile size="sm" role="img" aria-label={typeLabel}>
                  {channelTypeIcon(channel.type)}
                </IconTile>
                </Tooltip>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block max-w-full truncate rounded-sticker text-left text-subhead font-semibold text-foreground-muted underline decoration-[1.5px] underline-offset-[3px] outline-none hover:text-foreground focus-visible:shadow-focus"
                    aria-label={formatMessage(
                      { id: "settings.archivedChannels.openAriaLabel" },
                      { name: channel.name },
                    )}
                    onClick={() => nav.toChannel(channel.id)}
                  >
                    {channelName}
                  </button>
                  <div className="mt-0.5 truncate text-footnote text-foreground-muted">
                    {formatMessage(
                      { id: "settings.archivedChannels.metadata" },
                      {
                        type: typeLabel,
                        date: formatMediumDateTime(channel.archivedAt),
                      },
                    )}
                  </div>
                </div>
              </div>
              <UnarchiveChannelButton
                channel={channel}
                busy={busy}
                disabled={busyChannelId !== null}
                onUnarchive={handleUnarchive}
              />
            </div>
          );
        })}
      </Card>
    </section>
  );
}
