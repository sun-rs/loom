import { buildStructuredPreview } from "./structured-attachment-preview.ts";
import { serveHtmlAttachment } from "./html-attachment-preview.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import type {
  AuthenticatedActorContext,
  HumanApplicationPort,
} from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import type { ZodType } from "zod";

export const FILE_DATA_PATHS = [
  "/files/comments/list",
  "/files/comments/post",
  "/files/prepare",
  "/files/cancel",
  "/files/list",
];
export function routeFiles(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  path: string,
  body: Record<string, unknown>,
  parse: <T>(schema: ZodType<T>, body: Record<string, unknown>) => T,
) {
  if (path === "/files/comments/list")
    return human.listAttachmentComments(
      actor,
      parse(P.AttachmentCommentsRequestSchema, body),
    );
  if (path === "/files/comments/post")
    return human.postAttachmentComment(
      actor,
      parse(P.AttachmentCommentPostRequestSchema, body),
    );
  if (path === "/files/prepare")
    return human.prepareFile(actor, parse(P.FilePrepareRequestSchema, body));
  if (path === "/files/cancel")
    return human.cancelFile(actor, parse(P.FileIdRequestSchema, body));
  if (path === "/files/list")
    return human.listRoomFiles(actor, parse(P.RoomFilesRequestSchema, body));
  throw new Error("unsupported file route");
}
export async function transferFile(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
  writeJson: (response: ServerResponse, status: number, body: unknown) => void,
  purpose: "download" | "preview" | "html" | "data" | "pdf" = "download",
) {
  if (request.method === "PUT") {
    request.setTimeout(120_000, () => request.destroy());
    const result = await human.uploadFile(actor, id, request);
    writeJson(response, 200, P.FileUploadSchema.parse(result));
  } else if (request.method === "GET") {
    let download = await human.downloadFile(actor, id);
    if (purpose === "data") {
      writeJson(
        response,
        200,
        await buildStructuredPreview(download.attachment, download.stream),
      );
      return;
    }
    if (purpose === "html") {
      await serveHtmlAttachment(download, response);
      return;
    }
    if (purpose === "preview") {
      const kind = P.classifyAttachmentPreview(
        download.attachment.mimeType,
        download.attachment.filename,
      );
      if (
        kind === "image" ||
        kind === "unsupported" ||
        kind === "pdf" ||
        kind === "video" ||
        kind === "audio"
      ) {
        destroyReadable(download.stream);
        writeJson(response, 415, {
          error: {
            code: "preview_not_supported",
            message: "inline text preview is not supported for this file type",
          },
        });
        return;
      }
      if (download.attachment.size > P.MAX_ATTACHMENT_TEXT_PREVIEW_BYTES) {
        destroyReadable(download.stream);
        writeJson(response, 413, {
          error: {
            code: "preview_too_large",
            message: "file is too large for inline text preview",
          },
        });
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader(
        "X-Original-Content-Type",
        download.attachment.mimeType,
      );
      response.setHeader("Content-Length", download.attachment.size);
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; img-src 'self' data:; media-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
      );
      await pipeline(download.stream, response);
      return;
    }
    if (purpose === "pdf") {
      const metadataPdf =
        P.classifyAttachmentPreview(
          download.attachment.mimeType,
          download.attachment.filename,
        ) === "pdf";
      let valid = false;
      if (metadataPdf && download.attachment.size >= 5) {
        const prefix = await human.downloadFile(actor, id, {
          start: 0,
          end: 4,
        });
        const chunks: Buffer[] = [];
        for await (const chunk of prefix.stream)
          chunks.push(Buffer.from(chunk));
        valid = Buffer.concat(chunks).equals(Buffer.from("%PDF-"));
      }
      if (!valid) {
        destroyReadable(download.stream);
        writeJson(response, 415, {
          error: {
            code: "pdf_preview_unavailable",
            message: "A PDF attachment is required",
          },
        });
        return;
      }
    }
    const requestedRange = resolveByteRange(
      request.headers.range,
      download.attachment.size,
    );
    if (requestedRange.kind === "unsatisfiable") {
      destroyReadable(download.stream);
      response.statusCode = 416;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader(
        "Content-Range",
        `bytes */${String(download.attachment.size)}`,
      );
      response.setHeader("Cache-Control", "private, no-store");
      response.end();
      return;
    }
    if (requestedRange.kind === "partial") {
      destroyReadable(download.stream);
      download = await human.downloadFile(actor, id, {
        start: requestedRange.start,
        end: requestedRange.end,
      });
    }
    const { attachment, stream } = download;
    // Always download. Preview is an isolated client rendering, never serve user HTML as app-origin code.
    response.statusCode = requestedRange.kind === "partial" ? 206 : 200;
    response.setHeader(
      "Content-Type",
      purpose === "pdf" ? "application/pdf" : "application/octet-stream",
    );
    response.setHeader("Accept-Ranges", "bytes");
    if (requestedRange.kind === "partial") {
      response.setHeader(
        "Content-Range",
        `bytes ${String(requestedRange.start)}-${String(requestedRange.end)}/${String(attachment.size)}`,
      );
      response.setHeader(
        "Content-Length",
        requestedRange.end - requestedRange.start + 1,
      );
    } else {
      response.setHeader("Content-Length", attachment.size);
    }
    response.setHeader(
      "Content-Disposition",
      `${purpose === "pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, no-store");
    await pipeline(stream, response);
  } else {
    response.statusCode = 405;
    response.setHeader("Allow", "GET, PUT");
    response.end();
  }
}

type ResolvedByteRange =
  | Readonly<{ kind: "full" }>
  | Readonly<{ end: number; kind: "partial"; start: number }>
  | Readonly<{ kind: "unsatisfiable" }>;

/** Structural port of Multica's single byte-range fallback for a local stream. */
function resolveByteRange(
  header: string | undefined,
  total: number,
): ResolvedByteRange {
  const value = header?.trim() ?? "";
  if (value === "") return { kind: "full" };
  if (!value.startsWith("bytes=")) return { kind: "unsatisfiable" };
  const specification = value.slice("bytes=".length).trim();
  // RFC range sets are optional. Like Multica's forward-only fallback, ignore
  // a multi-range request and serve the complete representation.
  if (specification.includes(",")) return { kind: "full" };
  const match = /^(\d*)-(\d*)$/u.exec(specification);
  if (match === null || (match[1] === "" && match[2] === "")) {
    return { kind: "unsatisfiable" };
  }
  if (total === 0) return { kind: "full" };
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: "unsatisfiable" };
    }
    return {
      kind: "partial",
      start: Math.max(0, total - suffixLength),
      end: total - 1,
    };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? total - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= total ||
    requestedEnd < start
  ) {
    return { kind: "unsatisfiable" };
  }
  return {
    kind: "partial",
    start,
    end: Math.min(requestedEnd, total - 1),
  };
}

function destroyReadable(stream: NodeJS.ReadableStream): void {
  (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
}
