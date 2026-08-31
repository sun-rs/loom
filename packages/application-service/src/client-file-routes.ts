import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import type {
  AuthenticatedActorContext,
  HumanApplicationPort,
} from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import type { ZodType } from "zod";

export const FILE_DATA_PATHS = [
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
) {
  if (request.method === "PUT") {
    request.setTimeout(120_000, () => request.destroy());
    const result = await human.uploadFile(actor, id, request);
    writeJson(response, 200, P.FileUploadSchema.parse(result));
  } else {
    const { attachment, stream } = await human.downloadFile(actor, id);
    // Always download. Preview is an isolated client rendering, never serve user HTML as app-origin code.
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Length", attachment.size);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, no-store");
    await pipeline(stream, response);
  }
}
