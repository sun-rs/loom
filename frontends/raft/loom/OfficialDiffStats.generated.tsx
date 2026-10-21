// GENERATED from immutable Raft db5e399 MessageItem declaration; import-only binding.
import {useIntl} from "react-intl";
import {MessageAttachmentDiffSummary,MessageAttachmentDiffAddition,MessageAttachmentDiffDeletion} from "raft-ui";
import type {DiffAttachmentPreview} from "../packages/web/src/components/message/attachmentPreview";
export function DiffPatchStatsLine({ preview }: { preview: DiffAttachmentPreview | null }) {
  const { formatMessage } = useIntl();
  if (!preview) {
    return <span className="text-foreground-hint">{formatMessage({ id: "message.messageItem.diffPreview" })}</span>;
  }

  const { files, hunks, additions, deletions } = preview.stats;

  return (
    <MessageAttachmentDiffSummary className="inline-flex min-w-0 items-center">
      <span className="text-foreground-hint">{formatMessage({ id: "message.messageItem.diffStats" }, { fileCount: files, hunkCount: hunks })}</span>
      <MessageAttachmentDiffAddition>+{additions}</MessageAttachmentDiffAddition>
      <MessageAttachmentDiffDeletion>-{deletions}</MessageAttachmentDiffDeletion>
    </MessageAttachmentDiffSummary>
  );
}
