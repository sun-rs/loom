import type { AttachmentPreviewResponse } from "../packages/shared/src/attachmentPreview.ts";
/** Read-only authenticated gateway transport; no second preview business state. */
export async function readStructuredPreview(
  id: string,
  signal: AbortSignal,
): Promise<AttachmentPreviewResponse> {
  const response = await fetch(
    "/v3/client/files/data-preview/" + encodeURIComponent(id),
    { signal },
  );
  if (!response.ok) throw Error("无法读取附件预览，请重试");
  return response.json();
}
