import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

/** Gateway transport only: finite JSON bodies, never event streams or file ranges. */
export async function pipeApiResponse(
  request: IncomingMessage,
  upstream: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const h = upstream.headers;
  const eligible =
    request.method !== "HEAD" &&
    upstream.statusCode === 200 &&
    /^application\/json(?:;|$)/i.test(String(h["content-type"] ?? "")) &&
    Number(h["content-length"]) >= 1024 &&
    !h["content-range"] &&
    !h["content-encoding"] &&
    !/\bno-transform\b/i.test(String(h["cache-control"] ?? ""));
  const encodings = new Map(
    (request.headers["accept-encoding"] ?? "").split(",").map((part) => {
      const [name, ...params] = part.trim().toLowerCase().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return [name, q ? Number(q.trim().slice(2)) : 1] as const;
    }),
  );
  if (eligible) {
    const vary = String(response.getHeader("vary") ?? h.vary ?? "");
    response.setHeader(
      "vary",
      vary === "*" || /(?:^|,)\s*accept-encoding\s*(?:,|$)/i.test(vary)
        ? vary
        : [vary, "Accept-Encoding"].filter(Boolean).join(", "),
    );
  }
  if (eligible && (encodings.get("gzip") ?? encodings.get("*") ?? 0) > 0) {
    response.removeHeader("content-length");
    response.setHeader("content-encoding", "gzip");
    await pipeline(upstream, createGzip(), response);
  } else await pipeline(upstream, response);
}
