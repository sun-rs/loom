// GENERATED official content JSX and category declarations. Local wrapper supplies Loom releases only.
import {useIntl} from 'react-intl';
import {FileText} from 'lucide-react';
import {Badge,Button,Card} from 'raft-ui';
import type {MessageId} from '../packages/web/src/i18n/messages/en';
import Banner from '../packages/web/src/components/ui/Banner';
import SectionEyebrow from '@loom/raft-web-source/SectionEyebrow';
export type ReleaseNoteType = "feature" | "fix" | "improvement" | "breaking" | "deprecated";
export interface ReleaseNoteEntry {
  entryId: string;
  type: ReleaseNoteType;
  text: string;
  emphasis: boolean;
  ordinal: number;
}
export interface PublishedReleaseNote {
  releaseId: string;
  releaseKey: string;
  version: string | null;
  tag: string | null;
  date: string;
  revision: number;
  snapshotHash: string;
  publishedAt: string;
  state: "published" | "retracted";
  entries: ReleaseNoteEntry[];
}
const RELEASE_TYPE_CONFIG: Record<ReleaseNoteType, { labelId: MessageId; badgeVariant: "information" | "warning" | "success" | "accent" | "muted" }> = {
  feature: { labelId: "settings.releaseNotes.type.new", badgeVariant: "information" },
  fix: { labelId: "settings.releaseNotes.type.fix", badgeVariant: "warning" },
  improvement: { labelId: "settings.releaseNotes.type.improved", badgeVariant: "success" },
  breaking: { labelId: "settings.releaseNotes.type.breaking", badgeVariant: "accent" },
  deprecated: { labelId: "settings.releaseNotes.type.deprecated", badgeVariant: "muted" },
};
const RELEASE_CATEGORY_ORDER: ReleaseNoteType[] = [
  "feature",
  "improvement",
  "fix",
  "breaking",
  "deprecated",
];
export type ReleaseDisplay=Pick<PublishedReleaseNote,'releaseId'|'version'|'date'|'state'|'entries'>;
export function LoomReleaseNotes({releases}:{releases:readonly ReleaseDisplay[]}){
 const {formatMessage}=useIntl();
 const state={status:'ready' as string,releases};
 const currentReleaseId=releases.find((release) => release.state === "published")?.releaseId;
 const handleRetry=()=>{};
 return (<>
<div className="mb-3 flex items-center gap-2">
          <FileText size={16} className="text-foreground-hint" />
          <SectionEyebrow>{formatMessage({ id: "settings.releaseNotes.whatsNew" })}</SectionEyebrow>
        </div>

{state.status === "loading" ? (
          <p className="text-callout text-foreground-muted" role="status">
            {formatMessage({ id: "settings.releaseNotes.loading" })}
          </p>
        ) : null}

{state.status === "error" ? (
          <Banner
            intent="warning"
            withIcon
            role="alert"
            actions={(
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
              >
                {formatMessage({ id: "settings.releaseNotes.retry" })}
              </Button>
            )}
          >
            {formatMessage({ id: "settings.releaseNotes.unavailable" })}
          </Banner>
        ) : null}

{state.status === "ready" ? (
          <div className="space-y-4">
            {state.releases.map((release) => {
              const isCurrentRelease = release.releaseId === currentReleaseId;
              return (
                <Card
                  key={release.releaseId}
                  data-testid="release-entry"
                  className="p-4"
                >
                  {/* The release you are running is marked with the yellow
                      "you" sticker; versions and dates are machine text. */}
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-mono-meta text-foreground">
                      {release.version ? `${release.version} (${release.date})` : release.date}
                    </span>
                    {isCurrentRelease ? (
                      <Badge appearance="solid" variant="primary">
                        {formatMessage({ id: "settings.releaseNotes.current" })}
                      </Badge>
                    ) : null}
                    {release.state === "retracted" ? (
                      <Badge appearance="soft" variant="muted">
                        {formatMessage({ id: "settings.releaseNotes.retracted" })}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {RELEASE_CATEGORY_ORDER.map((type) => {
                      const entries = release.entries.filter((entry) => entry.type === type);
                      if (entries.length === 0) return null;
                      const config = RELEASE_TYPE_CONFIG[type];
                      return (
                        <div key={type}>
                          <Badge appearance="soft" variant={config.badgeVariant}>
                            {formatMessage({ id: config.labelId })}
                          </Badge>
                          <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-foreground-hint">
                            {entries.map((entry) => (
                              <li key={entry.entryId} className={`text-subhead text-foreground ${entry.emphasis ? "font-semibold" : ""}`}>
                                {entry.text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : null}
</>);
}
