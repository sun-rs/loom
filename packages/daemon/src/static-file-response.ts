import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

/** Shared static transport for local and LAN gateways; never compress API streams. */
export async function sendStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<void> {
  const type = String(response.getHeader("content-type") ?? "");
  const compressible =
    /^(text\/|application\/(javascript|json)|image\/svg\+xml)/u.test(type) &&
    statSync(path).size >= 1024;
  const accepted = new Map(
    (request.headers["accept-encoding"] ?? "").split(",").map((part) => {
      const [name, ...params] = part.trim().toLowerCase().split(";");
      const quality = params.find((value) => value.trim().startsWith("q="));
      return [name, quality ? Number(quality.trim().slice(2)) : 1] as const;
    }),
  );
  const gzip =
    compressible && (accepted.get("gzip") ?? accepted.get("*") ?? 0) > 0;
  if (compressible) response.setHeader("vary", "Accept-Encoding");
  if (gzip) response.setHeader("content-encoding", "gzip");
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  if (gzip) await pipeline(createReadStream(path), createGzip(), response);
  else await pipeline(createReadStream(path), response);
}
