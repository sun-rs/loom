import { createHmac, timingSafeEqual } from "node:crypto";

import { RoomDomainError, roomError } from "./room-errors";

type EventCursorState = {
  v: 1;
  g: string;
  k: "events";
  r: string;
  s: string;
  p: number;
  t?: number;
};

type OlderMessagesCursorState = {
  v: 1;
  g: string;
  k: "older_messages";
  r: string;
  s: string;
  a: number;
  t: number;
};

type InboxCursorState = {
  v: 1;
  g: string;
  k: "inbox";
  s: string;
  p: number;
};

type RoomListCursorState = {
  v: 1;
  g: string;
  k: "rooms";
  s: string;
  b: number;
  t: number;
};

type RoomReadCursorState =
  | EventCursorState
  | OlderMessagesCursorState
  | InboxCursorState
  | RoomListCursorState;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface RoomCursorKeyMaterial {
  generation: string;
  secret: Uint8Array;
}

function validSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Daemon-owned, versioned and authenticated cursor codec for Room read ports. */
export class RoomReadCursorCodec {
  readonly #secret: Buffer;
  readonly #generation: string;

  constructor(material: RoomCursorKeyMaterial) {
    if (!IDENTIFIER.test(material.generation)) {
      throw new Error("Room cursor generation must be a stable identifier");
    }
    if (material.secret.byteLength < 32) {
      throw new Error("Room cursor secret must contain at least 32 bytes");
    }
    this.#secret = Buffer.from(material.secret);
    this.#generation = material.generation;
  }

  subject(principalId: string): string {
    return this.#mac(`room-read-subject\0${principalId}`);
  }

  encodeEvents(input: {
    roomId: string;
    subject: string;
    position: number;
    through?: number;
  }): string {
    return this.#encode({
      v: 1,
      g: this.#generation,
      k: "events",
      r: input.roomId,
      s: input.subject,
      p: input.position,
      ...(input.through !== undefined ? { t: input.through } : {}),
    });
  }

  decodeEvents(cursor: string, roomId: string, subject: string): {
    position: number;
    through?: number;
  } {
    const state = this.#decode(cursor);
    if (
      state.k !== "events" ||
      state.r !== roomId ||
      state.s !== subject ||
      (state.t !== undefined && state.p > state.t)
    ) {
      throw this.#invalid();
    }
    return {
      position: state.p,
      ...(state.t !== undefined ? { through: state.t } : {}),
    };
  }

  encodeOlderMessages(input: {
    roomId: string;
    subject: string;
    anchor: number;
    through: number;
  }): string {
    return this.#encode({
      v: 1,
      g: this.#generation,
      k: "older_messages",
      r: input.roomId,
      s: input.subject,
      a: input.anchor,
      t: input.through,
    });
  }

  decodeOlderMessages(cursor: string, roomId: string, subject: string): {
    anchor: number;
    through: number;
  } {
    const state = this.#decode(cursor);
    if (
      state.k !== "older_messages" ||
      state.r !== roomId ||
      state.s !== subject ||
      state.a < 1 ||
      state.a > state.t + 1
    ) {
      throw this.#invalid();
    }
    return { anchor: state.a, through: state.t };
  }

  encodeInbox(input: { subject: string; position: number }): string {
    return this.#encode({
      v: 1,
      g: this.#generation,
      k: "inbox",
      s: input.subject,
      p: input.position,
    });
  }

  decodeInbox(cursor: string, subject: string): { position: number } {
    const state = this.#decode(cursor);
    if (state.k !== "inbox" || state.s !== subject) throw this.#invalid();
    return { position: state.p };
  }

  encodeRooms(input: { subject: string; before: number; through: number }): string {
    return this.#encode({
      v: 1,
      g: this.#generation,
      k: "rooms",
      s: input.subject,
      b: input.before,
      t: input.through,
    });
  }

  decodeRooms(cursor: string, subject: string): { before: number; through: number } {
    const state = this.#decode(cursor);
    if (
      state.k !== "rooms" ||
      state.s !== subject ||
      state.b < 1 ||
      state.b > state.t + 1
    ) throw this.#invalid();
    return { before: state.b, through: state.t };
  }

  #encode(state: RoomReadCursorState): string {
    const body = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
    return `${body}.${this.#mac(body)}`;
  }

  #decode(cursor: string): RoomReadCursorState {
    try {
      const segments = cursor.split(".");
      if (segments.length !== 2 || !segments[0] || !segments[1]) throw this.#invalid();
      const [body, signature] = segments as [string, string];
      const expected = Buffer.from(this.#mac(body), "utf8");
      const supplied = Buffer.from(signature, "utf8");
      if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) {
        throw this.#invalid();
      }
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw this.#invalid();
      const value = parsed as Record<string, unknown>;
      if (
        value.v !== 1 ||
        value.g !== this.#generation ||
        typeof value.k !== "string" ||
        typeof value.s !== "string"
      ) {
        throw this.#invalid();
      }
      if (value.k === "events") {
        if (
          typeof value.r !== "string" ||
          !IDENTIFIER.test(value.r) ||
          !validSequence(value.p) ||
          (value.t !== undefined && !validSequence(value.t))
        ) throw this.#invalid();
        return parsed as EventCursorState;
      }
      if (value.k === "older_messages") {
        if (
          typeof value.r !== "string" ||
          !IDENTIFIER.test(value.r) ||
          !validSequence(value.a) ||
          !validSequence(value.t)
        ) throw this.#invalid();
        return parsed as OlderMessagesCursorState;
      }
      if (value.k === "inbox") {
        if (!validSequence(value.p)) throw this.#invalid();
        return parsed as InboxCursorState;
      }
      if (value.k === "rooms") {
        if (!validSequence(value.b) || !validSequence(value.t)) throw this.#invalid();
        return parsed as RoomListCursorState;
      }
      throw this.#invalid();
    } catch (error) {
      if (error instanceof RoomDomainError) throw error;
      throw this.#invalid();
    }
  }

  #mac(value: string): string {
    return createHmac("sha256", this.#secret).update(value, "utf8").digest("base64url");
  }

  #invalid(): Error {
    return roomError("invalid_argument", "Room cursor is invalid for this request");
  }
}
