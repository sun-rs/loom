import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientRoomTimelineResponse,
  RoomTimelineItem,
} from "@rah-os/protocol";

export function timelinePosition(item: RoomTimelineItem) {
  return item.kind === "message" ? item.message : item.notice;
}
function identity(item: RoomTimelineItem) {
  return item.kind === "message"
    ? `message:${item.message.messageId}`
    : `notice:${item.notice.eventId}`;
}

/** The sole timeline cursor/window owner. Read-only; never advances human read or delivery ACK. */
export class RoomTimelineSession {
  private initialized = false;
  private before = 0;
  private after = 0;
  private earlier = false;
  private complete = false;
  private items: readonly RoomTimelineItem[] = Object.freeze([]);
  private readonly client: RahClient;
  private readonly roomId: string;
  constructor(client: RahClient, roomId: string) {
    this.client = client;
    this.roomId = roomId;
  }
  get state() {
    return Object.freeze({
      items: this.items,
      cursorBefore: this.before,
      cursorAfter: this.after,
      hasEarlier: this.earlier,
      complete: this.complete,
    });
  }
  private validate(
    page: ClientRoomTimelineResponse,
    boundary: { beforeSeq?: number; afterSeq?: number },
  ) {
    let previous = boundary.afterSeq ?? 0;
    for (const item of page.items) {
      const position = timelinePosition(item);
      if (position.roomId !== this.roomId)
        throw new Error("Timeline belongs to another Room");
      if (item.kind === "message" && item.message.threadId)
        throw new Error("Thread body cannot enter Room timeline");
      if (
        position.roomSeq <= previous ||
        (boundary.beforeSeq !== undefined &&
          position.roomSeq >= boundary.beforeSeq)
      )
        throw new Error("Timeline page crossed cursor or is unordered");
      previous = position.roomSeq;
    }
    const fallback = boundary.beforeSeq ?? boundary.afterSeq ?? 0;
    if (
      page.cursorBefore !==
        (page.items[0] ? timelinePosition(page.items[0]).roomSeq : fallback) ||
      page.cursorAfter !==
        (page.items.at(-1)
          ? timelinePosition(page.items.at(-1)!).roomSeq
          : fallback)
    )
      throw new Error("Timeline cursor does not match page contents");
    if (
      !page.items.length &&
      (boundary.beforeSeq !== undefined
        ? page.hasMoreBefore
        : page.hasMoreAfter)
    )
      throw new Error("Timeline pagination made no progress");
  }
  private merge(page: ClientRoomTimelineResponse) {
    const byId = new Map(this.items.map((item) => [identity(item), item]));
    for (const item of page.items) byId.set(identity(item), item);
    this.items = Object.freeze(
      [...byId.values()].sort(
        (a, b) => timelinePosition(a).roomSeq - timelinePosition(b).roomSeq,
      ),
    );
  }
  async syncUntilCurrent(
    options: { limit?: number; maxPages?: number; signal?: AbortSignal } = {},
  ) {
    const maxPages = options.maxPages ?? 2;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
      throw new Error("Invalid timeline page budget");
    for (let n = 0; n < maxPages; n++) {
      const boundary = this.initialized ? { afterSeq: this.after } : {};
      const page = await this.client.request(
        "room.timeline",
        { roomId: this.roomId, limit: options.limit ?? 50, ...boundary },
        options.signal ? { signal: options.signal } : undefined,
      );
      this.validate(page, boundary);
      if (!this.initialized || (!this.items.length && page.items.length)) {
        this.before = page.cursorBefore;
        this.earlier = page.hasMoreBefore;
      }
      this.after = page.cursorAfter;
      this.complete = !page.hasMoreAfter;
      this.merge(page);
      this.initialized = true;
      if (this.complete) break;
    }
    return this.state;
  }
  async loadEarlier(options: { limit?: number; signal?: AbortSignal } = {}) {
    if (!this.initialized) return this.syncUntilCurrent(options);
    if (!this.earlier) return this.state;
    const boundary = { beforeSeq: this.before };
    const page = await this.client.request(
      "room.timeline",
      { roomId: this.roomId, limit: options.limit ?? 50, ...boundary },
      options.signal ? { signal: options.signal } : undefined,
    );
    this.validate(page, boundary);
    this.before = page.cursorBefore;
    this.earlier = page.hasMoreBefore;
    this.merge(page);
    return this.state;
  }
}
