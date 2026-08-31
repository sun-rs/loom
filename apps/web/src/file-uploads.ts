import type { RahClient } from "@rah-os/client-sdk";
import { MAX_ATTACHMENT_BYTES } from "@rah-os/protocol";
import { opaqueIdFromBytes } from "@rah-os/ui-web";

export type DraftFile = {
  id: string;
  file: File;
  status: "uploading" | "ready" | "failed";
  attachmentId?: string | undefined;
  error?: string;
};
const EMPTY: readonly DraftFile[] = Object.freeze([]);
// Multica upload-coordinator ownership/generation guard, adapted to Room-keyed ephemeral drafts.
export class FileUploadStore {
  readonly #client: RahClient;
  readonly #rooms = new Map<string, readonly DraftFile[]>();
  readonly #listeners = new Set<() => void>();
  readonly #controllers = new Map<string, AbortController>();
  constructor(client: RahClient) {
    this.#client = client;
  }
  read = (roomId?: string) =>
    roomId ? (this.#rooms.get(roomId) ?? EMPTY) : EMPTY;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #write(roomId: string, rows: readonly DraftFile[]) {
    this.#rooms.set(roomId, rows);
    for (const listener of this.#listeners) listener();
  }
  async add(roomId: string, file: File) {
    if (this.read(roomId).length >= 10)
      throw new Error("每条消息最多 10 个附件");
    if (!file.size || file.size > MAX_ATTACHMENT_BYTES)
      throw new Error("请选择非空文件，单个文件不能超过 200 MiB");
    if (!this.#client.files) throw new Error("当前连接没有附件传输能力");
    const id = opaqueIdFromBytes(
      globalThis.crypto.getRandomValues(new Uint8Array(16)),
    );
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    this.#write(roomId, [
      ...this.read(roomId),
      { id, file, status: "uploading" },
    ]);
    let attachmentId: string | undefined;
    try {
      const prepared = await this.#client.request("file.prepare", {
        roomId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        idempotencyKey: `file-${id}`,
      });
      attachmentId = prepared.attachmentId;
      if (!this.read(roomId).some((row) => row.id === id)) {
        await this.#client.request("file.cancel", { attachmentId });
        return;
      }
      this.#write(
        roomId,
        this.read(roomId).map((row) =>
          row.id === id ? { ...row, attachmentId } : row,
        ),
      );
      await this.#client.files.upload(attachmentId, file, controller.signal);
      this.#write(
        roomId,
        this.read(roomId).map((row) =>
          row.id === id ? { ...row, status: "ready", attachmentId } : row,
        ),
      );
    } catch (error) {
      if (attachmentId)
        void this.#client
          .request("file.cancel", { attachmentId })
          .catch(() => {});
      this.#write(
        roomId,
        this.read(roomId).map((row) =>
          row.id === id
            ? {
                ...row,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
              }
            : row,
        ),
      );
    } finally {
      this.#controllers.delete(id);
    }
  }
  remove(roomId: string, id: string) {
    const row = this.read(roomId).find((row) => row.id === id);
    this.#controllers.get(id)?.abort();
    this.#write(
      roomId,
      this.read(roomId).filter((row) => row.id !== id),
    );
    if (row?.attachmentId)
      void this.#client
        .request("file.cancel", { attachmentId: row.attachmentId })
        .catch(() => {});
  }
  accept(roomId: string, ids: readonly string[]) {
    this.#write(
      roomId,
      this.read(roomId).filter((row) => !ids.includes(row.id)),
    );
  }
  dispose() {
    for (const [roomId, rows] of this.#rooms)
      for (const row of rows) this.remove(roomId, row.id);
  }
}
