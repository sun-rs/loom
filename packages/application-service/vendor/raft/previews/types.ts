// Local metadata binding for the upstream providers; no Raft DB dependency.
import type { AttachmentPreviewData } from "./shared.ts";
export interface AttachmentPreviewMetadata {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}
export interface AttachmentPreviewProvider<
  T extends AttachmentPreviewData = AttachmentPreviewData,
> {
  kind: T["kind"];
  trustLevel: "data" | "sandbox";
  streamByteCap: number;
  payloadByteCap: number;
  canPreview(attachment: AttachmentPreviewMetadata): boolean;
  buildPreview(args: {
    attachment: AttachmentPreviewMetadata;
    buffer: Buffer;
    truncated: boolean;
  }): Promise<T | null>;
}
