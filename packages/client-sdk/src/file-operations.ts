import * as P from "@rah-os/protocol";
import type { z } from "zod";
export const fileOperations = {
  "file.prepare": {
    input: P.FilePrepareRequestSchema,
    output: P.FileUploadSchema,
    path: "/v3/client/files/prepare",
    authenticated: true,
    method: "POST",
  },
  "file.cancel": {
    input: P.FileIdRequestSchema,
    output: P.FileUploadSchema,
    path: "/v3/client/files/cancel",
    authenticated: true,
    method: "POST",
  },
  "file.list": {
    input: P.RoomFilesRequestSchema,
    output: P.RoomFilesResponseSchema,
    path: "/v3/client/files/list",
    authenticated: true,
    method: "POST",
  },
} as const;
export type FileOperationMap = {
  [K in keyof typeof fileOperations]: {
    input: z.infer<(typeof fileOperations)[K]["input"]>;
    output: z.infer<(typeof fileOperations)[K]["output"]>;
  };
};

export interface RahFileTransport {
  upload(
    attachmentId: string,
    body: Blob,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof P.FileUploadSchema>>;
  download(attachmentId: string, signal?: AbortSignal): Promise<Blob>;
  previewText(attachmentId: string, signal?: AbortSignal): Promise<string>;
  downloadRange(
    attachmentId: string,
    range: Readonly<{ end?: number; start: number }>,
    signal?: AbortSignal,
  ): Promise<Blob>;
}

export function createFileTransport(
  baseUrl: string,
  accessToken: () => string | undefined,
  fetcher: typeof fetch = globalThis.fetch,
): RahFileTransport {
  async function request(
    id: string,
    body?: Blob,
    signal?: AbortSignal,
    range?: Readonly<{ end?: number; start: number }>,
    purpose: "content" | "preview" = "content",
  ) {
    const token = accessToken();
    if (!token) throw new Error("a Human access token is required");
    const response = await fetcher(
      `${baseUrl}/v3/client/files/${purpose}/${encodeURIComponent(id)}`,
      {
        method: body ? "PUT" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/octet-stream" } : {}),
          ...(range
            ? {
                range: `bytes=${String(range.start)}-${range.end === undefined ? "" : String(range.end)}`,
              }
            : {}),
        },
        ...(body ? { body } : {}),
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.ok) {
      const payload = P.ClientErrorResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      throw new Error(
        payload.success
          ? payload.data.error.message
          : `file request failed (${response.status})`,
      );
    }
    return response;
  }
  return {
    upload: async (id, body, signal) =>
      P.FileUploadSchema.parse(await (await request(id, body, signal)).json()),
    download: async (id, signal) =>
      (await request(id, undefined, signal)).blob(),
    previewText: async (id, signal) =>
      (await request(id, undefined, signal, undefined, "preview")).text(),
    downloadRange: async (id, range, signal) => {
      if (
        !Number.isSafeInteger(range.start) ||
        range.start < 0 ||
        (range.end !== undefined &&
          (!Number.isSafeInteger(range.end) || range.end < range.start))
      ) {
        throw new Error("file byte range is invalid");
      }
      const response = await request(id, undefined, signal, range);
      if (response.status !== 206) {
        throw new Error("file server did not honor the requested byte range");
      }
      const contentRange = response.headers.get("content-range");
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(contentRange ?? "");
      if (match === null || Number(match[1]) !== range.start) {
        throw new Error("file server returned an invalid byte range");
      }
      const returnedEnd = Number(match[2]);
      if (
        returnedEnd < range.start ||
        (range.end !== undefined && returnedEnd > range.end)
      ) {
        throw new Error("file server returned an unexpected byte range");
      }
      const blob = await response.blob();
      if (blob.size !== returnedEnd - range.start + 1) {
        throw new Error("file server returned a truncated byte range");
      }
      return blob;
    },
  };
}
