import type { IncomingMessage, ServerResponse } from "node:http";
import { serveWorkspacePreview } from "./workspace-preview-gateway.ts";
/** HTTPS adapter reuses the existing Human-scoped preview owners. */
export async function handleWorkbenchPreview(
  request: IncomingMessage,
  response: ServerResponse,
  options: Parameters<typeof serveWorkspacePreview>[2],
): Promise<boolean> {
  const url = new URL(request.url ?? "/", options.origin);
  if (
    ["/_rah/workspace-preview/html", "/_rah/workspace-preview/pdf"].includes(
      url.pathname,
    )
  ) {
    // HTML owner supplies CSP sandbox + frame-ancestors; the shell's DENY
    // header must not prevent the app from displaying its isolated preview.
    response.removeHeader("x-frame-options");
    await serveWorkspacePreview(request, response, options);
    return true;
  }
  const match = /^\/_rah\/pdf-preview\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (!match) return false;
  response.setHeader("cache-control", "no-store");
  if (request.method !== "POST") response.writeHead(405).end();
  else if (!options.authorized || request.headers.origin !== options.origin)
    response.writeHead(403).end();
  else {
    try {
      const previewUrl = await options.pdf.issue(match[1]!);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ url: previewUrl }));
    } catch {
      response.writeHead(415).end("PDF preview unavailable");
    }
  }
  return true;
}
