import type { Readable } from "node:stream";
import type { AttachmentPreviewResponse } from "../vendor/raft/previews/shared.ts";
import { csvPreviewProvider } from "../vendor/raft/previews/csv.ts";
import { xlsxPreviewProvider } from "../vendor/raft/previews/xlsx.ts";
import { diffPatchPreviewProvider } from "../vendor/raft/previews/diffPatch.ts";
/** Local stream/ACL binding; parsing and limits belong to the official providers. */
export async function buildStructuredPreview(
  file: { filename: string; mimeType: string; size: number },
  stream: Readable,
): Promise<AttachmentPreviewResponse> {
  const attachment = { ...file, sizeBytes: file.size };
  const provider = [
    diffPatchPreviewProvider,
    csvPreviewProvider,
    xlsxPreviewProvider,
  ].find((p) => p.canPreview(attachment));
  if (!provider) {
    stream.destroy();
    return { status: "unsupported", reason: "unsupported" };
  }
  const chunks: Buffer[] = [];
  let length = 0,
    truncated = false;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    const remaining = provider.streamByteCap - length;
    chunks.push(bytes.subarray(0, remaining));
    length += Math.min(bytes.length, remaining);
    if (bytes.length > remaining) {
      truncated = true;
      break;
    }
  }
  const data = await provider.buildPreview({
    attachment,
    buffer: Buffer.concat(chunks),
    truncated,
  });
  if (!data) return { status: "unsupported", reason: "unreadable" };
  if (Buffer.byteLength(JSON.stringify(data)) > provider.payloadByteCap)
    return { status: "unsupported", reason: "too_large" };
  return {
    status: "ok",
    data,
    truncated:
      truncated ||
      (data.kind === "csv" && data.rows.length < data.rowCount) ||
      (data.kind === "xlsx" && data.truncated),
  };
}
