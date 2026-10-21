// GENERATED from immutable Raft db5e399 module. Import-only bindings to the shared Loom presentation graph; do not edit.
import { useIntl } from "react-intl";
import { MessageAttachmentMetaStart } from "raft-ui";
import { formatFileSizeBytes } from "../packages/web/src/utils/fileSizePresentation";

export function AttachmentMetaText({
  label,
  sizeBytes,
}: {
  label: string;
  sizeBytes?: number;
}) {
  const { formatMessage } = useIntl();
  return (
    <MessageAttachmentMetaStart
      data-message-affordance="attachment-meta"
      className="inline-flex max-w-full items-center gap-1.5"
    >
      <span data-message-affordance="attachment-meta-label" className="min-w-0 flex-1 truncate">{label}</span>
      {sizeBytes && sizeBytes > 0 ? (
        <>
          <span className="shrink-0 text-foreground-hint">·</span>
          <span data-message-affordance="attachment-meta-size" className="shrink-0">{formatFileSizeBytes(sizeBytes, formatMessage)}</span>
        </>
      ) : null}
    </MessageAttachmentMetaStart>
  );
}
