import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientMessageForwardRequestSchema,
  ClientMessageForwardResponseSchema,
  ClientMessageForwardTargetsRequestSchema,
  MessageSchema,
} from "../src/index.ts";

const forwardedBundle = {
  kind: "forwarded-bundle" as const,
  version: 1 as const,
  sourceRoom: {
    kind: "channel" as const,
    name: "Source",
    roomId: "room-source",
    slug: "source",
  },
  items: [
    {
      actor: {
        displayName: "Alice",
        handle: "alice",
        kind: "agent" as const,
        principalId: "principal-alice",
      },
      attachments: [],
      body: "canonical source body",
      createdAt: "2026-09-03T10:00:00.000Z",
      isThreadChild: false,
      sourceMessageId: "message-source",
      sourceRoomSeq: 7,
    },
  ],
};

test("forwarded bundles are immutable Message evidence, not synthesized body text", () => {
  const message = MessageSchema.parse({
    actorId: "principal-human",
    body: "",
    createdAt: "2026-09-03T10:01:00.000Z",
    forwardedBundle,
    messageId: "message-forwarded",
    roomId: "room-target",
    roomSeq: 9,
  });
  assert.deepEqual(message.forwardedBundle, forwardedBundle);
  assert.throws(
    () =>
      MessageSchema.parse({
        actorId: "principal-human",
        body: "",
        createdAt: "2026-09-03T10:01:00.000Z",
        messageId: "message-empty",
        roomId: "room-target",
        roomSeq: 10,
      }),
    /message body or attachment or forwarded bundle is required/u,
  );
});

test("projected attachment policy carries its availability provenance as one contract", () => {
  const attachment = {
    attachmentId: "projected-attachment",
    filename: "evidence.txt",
    mimeType: "text/plain",
    sha256: "a".repeat(64),
    size: 5,
  };
  const projected = MessageSchema.parse({
    actorId: "principal-human",
    body: "",
    createdAt: "2026-09-03T10:01:00.000Z",
    forwardedBundle: {
      ...forwardedBundle,
      items: [
        {
          ...forwardedBundle.items[0],
          attachmentPolicy: "projected",
          attachments: [attachment],
          provenanceState: "available",
        },
      ],
    },
    messageId: "message-forwarded-attachment",
    roomId: "room-target",
    roomSeq: 10,
  });
  assert.equal(
    projected.forwardedBundle?.items[0]?.attachmentPolicy,
    "projected",
  );
  assert.throws(() =>
    MessageSchema.parse({
      ...projected,
      forwardedBundle: {
        ...projected.forwardedBundle,
        items: [
          {
            ...projected.forwardedBundle!.items[0],
            provenanceState: undefined,
          },
        ],
      },
    }),
  );
});

test("forward requests freeze unique sources and at most ten unique destinations", () => {
  const parsed = ClientMessageForwardRequestSchema.parse({
    destinationRoomIds: ["room-one", "room-two"],
    note: "for context",
    requestId: "forward-request",
    sourceMessageIds: ["message-one", "message-two"],
    sourceRoomId: "room-source",
  });
  assert.equal(parsed.destinationRoomIds.length, 2);
  assert.throws(() =>
    ClientMessageForwardRequestSchema.parse({
      ...parsed,
      sourceMessageIds: ["message-one", "message-one"],
    }),
  );
  assert.throws(() =>
    ClientMessageForwardRequestSchema.parse({
      ...parsed,
      destinationRoomIds: Array.from(
        { length: 11 },
        (_, index) => `room-${String(index)}`,
      ),
    }),
  );
});

test("forward target search is bounded and forward results preserve partial delivery", () => {
  assert.equal(
    ClientMessageForwardTargetsRequestSchema.parse({
      limit: 20,
      query: "design",
      sourceRoomId: "room-source",
    }).limit,
    20,
  );
  assert.throws(() =>
    ClientMessageForwardTargetsRequestSchema.parse({
      limit: 21,
      sourceRoomId: "room-source",
    }),
  );
  const response = ClientMessageForwardResponseSchema.parse({
    requestId: "forward-request",
    results: [
      {
        deduplicated: false,
        destinationRoomId: "room-one",
        messageId: "message-forwarded-one",
        status: "delivered",
      },
      {
        code: "destination_not_available",
        destinationRoomId: "room-two",
        message: "destination is not available",
        status: "failed",
      },
    ],
  });
  assert.deepEqual(
    response.results.map(({ status }) => status),
    ["delivered", "failed"],
  );
});
