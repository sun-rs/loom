import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { ChannelWorkspaceReadRequestSchema } from "@rah-os/protocol";
import { readWorkspacePreview } from "./workspace-preview-read.ts";
import type { PdfPreviewGateway } from "./pdf-preview-gateway.ts";
import { serveHtmlAttachment } from "../../application-service/src/html-attachment-preview.ts";
/** Transport only: source bytes remain root-scoped Human reads, never published artifacts. */
export async function serveWorkspacePreview(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    daemonOrigin: string;
    accessToken: string;
    pdf: PdfPreviewGateway;
    authorized: boolean;
    origin: string;
  },
) {
  if (!options.authorized) {
    res.writeHead(403).end();
    return;
  }
  const url = new URL(req.url!, options.origin);
  if (url.search.length > 16000) {
    res.writeHead(413).end();
    return;
  }
  try {
    const input = ChannelWorkspaceReadRequestSchema.parse(
      JSON.parse(url.searchParams.get("input") ?? ""),
    );
    if (input.operation !== "read") throw Error("File read required");
    if (url.pathname.endsWith("/pdf")) {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      if (req.headers.origin !== options.origin) {
        res.writeHead(403).end();
        return;
      }
      const previewUrl = await options.pdf.issueWorkspace(input);
      res
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify({ url: previewUrl }));
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (!/\.html?$/i.test(input.path)) throw Error("HTML required");
    const file = await readWorkspacePreview(options, input);
    if (file.encoding !== "utf-8") throw Error("HTML text required");
    const bytes = Buffer.from(file.content!);
    await serveHtmlAttachment(
      {
        attachment: {
          filename: input.path,
          mimeType: "text/html",
          size: bytes.length,
        },
        stream: Readable.from(bytes),
      } as Parameters<typeof serveHtmlAttachment>[0],
      res,
    );
  } catch {
    if (!res.headersSent)
      res.writeHead(415).end("Workspace preview unavailable");
    else res.destroy();
  }
}
