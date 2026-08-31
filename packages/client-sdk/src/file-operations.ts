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
}

export function createFileTransport(
  baseUrl: string,
  accessToken: () => string | undefined,
  fetcher: typeof fetch = globalThis.fetch,
): RahFileTransport {
  async function request(id: string, body?: Blob, signal?: AbortSignal) {
    const token = accessToken();
    if (!token) throw new Error("a Human access token is required");
    const response = await fetcher(
      `${baseUrl}/v3/client/files/content/${encodeURIComponent(id)}`,
      {
        method: body ? "PUT" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/octet-stream" } : {}),
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
  };
}
