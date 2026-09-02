import type { RahClient } from "@rah-os/client-sdk";
import type { MessageSocialItem } from "@rah-os/protocol";
import { opaqueIdFromBytes } from "@rah-os/ui-web";

export const socialRequestId = () =>
  opaqueIdFromBytes(crypto.getRandomValues(new Uint8Array(16)));
type State = { data?: MessageSocialItem; pending?: boolean; error?: string };
/** Bounded mounted-message projection; no transcripts or business state in browser storage. */
export class MessageSocialStore {
  readonly #client: RahClient;
  readonly #states = new Map<string, State>();
  readonly #watched = new Map<
    string,
    { roomId: string; messageId: string; count: number }
  >();
  readonly #epochs = new Map<string, number>();
  readonly #listeners = new Set<() => void>();
  #disposed = false;
  #reading = false;
  #clock = 0;
  constructor(client: RahClient) {
    this.#client = client;
  }
  key = (roomId: string, messageId: string) =>
    JSON.stringify([roomId, messageId]);
  get size() {
    return this.#watched.size;
  }
  read = (roomId: string, messageId: string) =>
    this.#states.get(this.key(roomId, messageId));
  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };
  #set(key: string, state: State) {
    if (this.#disposed) return;
    if (JSON.stringify(this.#states.get(key)) === JSON.stringify(state)) return;
    this.#states.set(key, state);
    for (const fn of this.#listeners) fn();
  }
  watch(roomId: string, messageId: string) {
    const key = this.key(roomId, messageId),
      entry = this.#watched.get(key);
    this.#watched.set(key, {
      roomId,
      messageId,
      count: (entry?.count ?? 0) + 1,
    });
    if (!entry) this.#epochs.set(key, ++this.#clock);
    return () => {
      const current = this.#watched.get(key);
      if (current && current.count > 1) current.count--;
      else {
        this.#watched.delete(key);
        this.#states.delete(key);
        this.#epochs.delete(key);
      }
    };
  }
  async refresh() {
    if (this.#disposed || this.#reading) return;
    this.#reading = true;
    try {
      const rooms = new Map<string, string[]>();
      for (const w of this.#watched.values())
        rooms.set(w.roomId, [...(rooms.get(w.roomId) ?? []), w.messageId]);
      for (const [roomId, ids] of rooms)
        for (let index = 0; index < ids.length; index += 100) {
          const messageIds = ids.slice(index, index + 100),
            epochs = new Map(
              messageIds.map((id) => [
                id,
                this.#epochs.get(this.key(roomId, id)) ?? 0,
              ]),
            );
          try {
            const result = await this.#client.request("message.social", {
              roomId,
              messageIds,
            });
            for (const item of result.items) {
              const key = this.key(roomId, item.messageId),
                old = this.#states.get(key);
              if (
                this.#watched.has(key) &&
                !old?.pending &&
                epochs.get(item.messageId) === (this.#epochs.get(key) ?? 0) &&
                item.version >= (old?.data?.version ?? 0)
              )
                this.#set(key, { data: item });
            }
          } catch {
            // This is a background projection shared by every mounted Message.
            // Transport/session failures belong to the global connection owner;
            // repeating one failure below every Message makes the transcript
            // unusable. Preserve any last good social state and retry later.
          }
        }
    } finally {
      this.#reading = false;
    }
  }
  async mutate(
    message: { roomId: string; messageId: string; roomSeq: number },
    kind: "save" | "reaction",
    active: boolean,
    emoji?: string,
  ) {
    const key = this.key(message.roomId, message.messageId),
      old = this.#states.get(key);
    if (old?.pending) return;
    const epoch = ++this.#clock;
    this.#epochs.set(key, epoch);
    this.#set(key, { ...old, pending: true });
    try {
      const base = {
        roomId: message.roomId,
        messageId: message.messageId,
        idempotencyKey: socialRequestId(),
      };
      const data =
        kind === "save"
          ? await this.#client.request("message.save", {
              ...base,
              saved: active,
            })
          : await this.#client.request("message.react", {
              ...base,
              active,
              emoji: emoji!,
              basedOnRoomSeq: message.roomSeq,
            });
      if (this.#epochs.get(key) === epoch) {
        this.#epochs.set(key, ++this.#clock);
        this.#set(key, { data });
      }
    } catch (error) {
      if (this.#epochs.get(key) === epoch)
        this.#set(key, {
          ...(old?.data ? { data: old.data } : {}),
          error: error instanceof Error ? error.message : "操作失败，请重试",
        });
      throw error;
    }
  }
  dispose() {
    this.#disposed = true;
    this.#watched.clear();
    this.#states.clear();
    this.#epochs.clear();
    this.#listeners.clear();
  }
}
