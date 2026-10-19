import { FilePreviewBadge } from "raft-ui";
import { attachmentBadgeType } from "../../utils/attachmentBadgeType";

/** v1.21.22 l2: native inline FilePreviewBadge, caller supplies dimensions.
 * Source and provenance: page-adoption.json. Unknown extensions stay omitted. */
export function AttachmentTypeBadge({
  filename,
  className = "",
  "data-testid": testId,
  "data-message-affordance": affordance,
}: {
  filename: string;
  className?: string;
  "data-testid"?: string;
  "data-message-affordance"?: string;
}) {
  const type = attachmentBadgeType(filename);
  if (!type) return null;
  const label = (filename.split(".").pop() ?? "").toUpperCase();

  return (
    <FilePreviewBadge
      data-testid={testId}
      data-message-affordance={affordance}
      placement="inline"
      className={className}
    >
      {label}
    </FilePreviewBadge>
  );
}
