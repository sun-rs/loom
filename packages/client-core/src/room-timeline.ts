/*
 * Window-trimming design adapted from matrix-js-sdk TimelineWindow.
 * Copyright 2016 - 2021 The Matrix.org Foundation C.I.C.
 * Licensed under Apache-2.0; see licenses/matrix-Apache-2.0.txt.
 * Local changes: owned bounded arrays, byte budget, pinned overlap, Loom cursors.
 */
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
  private followingLatest = true;
  private knownHead = 0;
  private observedHead = 0;
  private generation = 0;
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
      complete: this.complete && this.observedHead >= this.knownHead,
    });
  }
  setFollowingLatest(value: boolean) {
    this.followingLatest = value;
  }
  /** Poll durable state without refilling a historical window behind the reader. */
  async refresh(
    options: { latestRoomSeq?: number; signal?: AbortSignal } = {},
  ) {
    this.knownHead = Math.max(this.knownHead, options.latestRoomSeq ?? 0);
    if (this.initialized && (!this.complete || !this.followingLatest))
      return this.state;
    return this.syncUntilCurrent({
      limit: 50,
      maxPages: 2,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
  private assertCurrent(generation: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (generation !== this.generation)
      throw new Error("Timeline read superseded");
  }
  /** Matrix TimelineWindow's opposite-edge trim, applied to owned data rather than indices.
   * Apache-2.0 reference: d0e8162, src/timeline-window.ts extend/unpaginate.
   * Keep one oversized item intact rather than silently truncating message bodies. */
  private trim(
    direction: "older" | "newer",
    focusId?: string,
    retainSeq?: number,
  ) {
    const sizes = this.items.map(
      (item) => new TextEncoder().encode(JSON.stringify(item)).length,
    );
    let bytes = sizes.reduce((a, b) => a + b, 0),
      start = 0,
      end = this.items.length;
    const focus = this.items.findIndex((i) =>
      focusId
        ? i.kind === "message" && i.message.messageId === focusId
        : timelinePosition(i).roomSeq === retainSeq,
    );
    while (end - start > 1 && (end - start > 300 || bytes > 2 * 1024 * 1024)) {
      const dropStart =
        focus >= 0 ? focus - start >= end - 1 - focus : direction === "newer";
      if (dropStart) bytes -= sizes[start++]!;
      else bytes -= sizes[--end]!;
    }
    if (start > 0) this.earlier = true;
    if (end < this.items.length) this.complete = false;
    this.items = Object.freeze(this.items.slice(start, end));
    if (this.items.length) {
      this.before = timelinePosition(this.items[0]!).roomSeq;
      this.after = timelinePosition(this.items.at(-1)!).roomSeq;
    }
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
  /** Replace the window around a validated message, without reading intervening history. */
  async focus(messageId: string, signal?: AbortSignal) {
    const generation = ++this.generation,
      head = this.knownHead;
    const { message } = await this.client.request(
      "message.context",
      { roomId: this.roomId, messageId },
      signal ? { signal } : undefined,
    );
    if (
      message.roomId !== this.roomId ||
      message.messageId !== messageId ||
      message.threadId
    )
      throw Error("Message focus scope mismatch");
    const boundary = { beforeSeq: message.roomSeq + 1 };
    const page = await this.client.request(
      "room.timeline",
      { roomId: this.roomId, limit: 50, ...boundary },
      signal ? { signal } : undefined,
    );
    this.validate(page, boundary);
    if (
      !page.items.some(
        (i) => i.kind === "message" && i.message.messageId === messageId,
      )
    )
      throw Error("Focused message unavailable");
    const following = await this.client.request(
      "room.timeline",
      { roomId: this.roomId, afterSeq: message.roomSeq, limit: 25 },
      signal ? { signal } : undefined,
    );
    this.assertCurrent(generation, signal);
    this.validate(following, { afterSeq: message.roomSeq });
    this.items = Object.freeze([...page.items, ...following.items]);
    this.before = page.cursorBefore;
    this.after = following.cursorAfter;
    this.earlier = page.hasMoreBefore;
    this.complete = !following.hasMoreAfter;
    this.initialized = true;
    this.followingLatest = false;
    this.observedHead = head;
    this.trim("newer", messageId);
    return this.state;
  }
  async syncUntilCurrent(
    options: { limit?: number; maxPages?: number; signal?: AbortSignal } = {},
  ) {
    const generation = ++this.generation,
      head = this.knownHead;
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
      this.assertCurrent(generation, options.signal);
      this.validate(page, boundary);
      if (!this.initialized || (!this.items.length && page.items.length)) {
        this.before = page.cursorBefore;
        this.earlier = page.hasMoreBefore;
      }
      this.after = page.cursorAfter;
      this.complete = !page.hasMoreAfter;
      this.merge(page);
      this.observedHead = head;
      this.trim("newer", undefined, boundary.afterSeq);
      this.initialized = true;
      if (this.complete) break;
    }
    return this.state;
  }
  async loadEarlier(options: { limit?: number; signal?: AbortSignal } = {}) {
    if (!this.initialized) return this.syncUntilCurrent(options);
    if (!this.earlier) return this.state;
    const generation = ++this.generation;
    const boundary = { beforeSeq: this.before };
    const page = await this.client.request(
      "room.timeline",
      { roomId: this.roomId, limit: options.limit ?? 50, ...boundary },
      options.signal ? { signal: options.signal } : undefined,
    );
    this.validate(page, boundary);
    this.assertCurrent(generation, options.signal);
    this.before = page.cursorBefore;
    this.earlier = page.hasMoreBefore;
    this.merge(page);
    this.trim("older", undefined, boundary.beforeSeq);
    return this.state;
  }
}
