import { useState, useEffect } from "react";
import type { DiffAttachmentPreview } from "../packages/web/src/components/message/attachmentPreview";
import { readStructuredPreview } from "./structured-preview";
import { DiffPatchStatsLine } from "./OfficialDiffStats.generated";
export { DiffPatchStatsLine } from "./OfficialDiffStats.generated";
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
