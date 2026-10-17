// Structurally extracted from official MessageItem.tsx a98ae00; renderer unchanged.
import { useIntl } from "react-intl";
import {
  MessageAttachmentDiffSummary,
  MessageAttachmentDiffAddition,
  MessageAttachmentDiffDeletion,
} from "raft-ui";
import type { DiffAttachmentPreview } from "../packages/web/src/components/message/attachmentPreview.ts";
import { useState, useEffect } from "react";
import { readStructuredPreview } from "./structured-preview.ts";
export function DiffPatchStatsLine({
  preview,
}: {
  preview: DiffAttachmentPreview | null;
}) {
  const { formatMessage } = useIntl();
  if (!preview) {
    return (
      <span className="text-foreground-muted theme-brutal:text-black/70">
        {formatMessage({ id: "message.messageItem.diffPreview" })}
      </span>
    );
  }

  const { files, hunks, additions, deletions } = preview.stats;

  return (
    <MessageAttachmentDiffSummary className="inline-flex min-w-0 items-center">
      <span className="text-foreground-muted theme-brutal:text-black/70">
        {formatMessage(
          { id: "message.messageItem.diffStats" },
          { fileCount: files, hunkCount: hunks },
        )}
      </span>
      <MessageAttachmentDiffAddition>
        +{additions}
      </MessageAttachmentDiffAddition>
      <MessageAttachmentDiffDeletion>
        -{deletions}
      </MessageAttachmentDiffDeletion>
    </MessageAttachmentDiffSummary>
  );
}

export default function DiffSummary({ id }: { id: string }) {
  const [preview, setPreview] = useState<DiffAttachmentPreview | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    void readStructuredPreview(id, controller.signal)
      .then((result) => {
        if (
          !controller.signal.aborted &&
          result.status === "ok" &&
          result.data.kind === "diff"
        )
          setPreview(result.data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id]);
  return <DiffPatchStatsLine preview={preview} />;
}
