import { pipeline } from "node:stream/promises";
import type { ServerResponse } from "node:http";
import {
  classifyAttachmentPreview,
  MAX_ATTACHMENT_TEXT_PREVIEW_BYTES,
} from "@rah-os/protocol";
import type { HumanApplicationPort } from "@rah-os/kernel";
import { createAttachmentPreviewBridgeTransform } from "../vendor/raft/attachmentPreviewBridge.ts";
// Structural port: raft-source a98ae00 routes/attachments.ts
// buildHtmlPreviewContentSecurityPolicy. Same-origin gateway replaces Raft's
// configured web-origin list; the CSP sandbox also applies to direct navigation.
export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "sandbox allow-scripts",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  "img-src data: blob: https:",
  "font-src data: https:",
  "media-src data: blob: https:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "worker-src 'none'",
  "frame-ancestors 'self'",
].join("; ");
export async function serveHtmlAttachment(
  download: Awaited<ReturnType<HumanApplicationPort["downloadFile"]>>,
  response: ServerResponse,
) {
  const { attachment, stream } = download;
  const kind = classifyAttachmentPreview(
    attachment.mimeType,
    attachment.filename,
  );
  if (kind !== "html" || attachment.size > MAX_ATTACHMENT_TEXT_PREVIEW_BYTES) {
    (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
    response.statusCode = kind !== "html" ? 415 : 413;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        error: {
          code: "html_preview_unavailable",
          message:
            "HTML preview requires an HTML attachment within the text preview limit",
        },
      }),
    );
    return;
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Security-Policy", HTML_PREVIEW_CSP);
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Disposition", "inline");
  await pipeline(stream, createAttachmentPreviewBridgeTransform(), response);
}
