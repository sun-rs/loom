import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentAnchorTarget,
  attachmentAnchorLabel,
  orderAttachmentComments,
} from "../src/attachment-comment-anchors.ts";

test("Raft line/CSV anchor ranges stay inside the rendered viewer and bound highlight work", () => {
  assert.deepEqual(
    attachmentAnchorTarget(
      { type: "lines", data: { start: 2, end: 999999 } },
      "text",
    ),
    { kind: "lines", start: 2, end: 202 },
  );
  assert.deepEqual(
    attachmentAnchorTarget({ type: "csv-rows", data: { start: 3 } }, "csv"),
    { kind: "rows", start: 3, end: 3 },
  );
  for (const start of [-1, 0, 1.5, Infinity, "2"])
    assert.equal(
      attachmentAnchorTarget({ type: "lines", data: { start } }, "text"),
      undefined,
    );
  assert.equal(
    attachmentAnchorTarget(
      { type: "lines", data: { start: 2, end: 1 } },
      "text",
    ),
    undefined,
  );
  assert.equal(
    attachmentAnchorTarget({ type: "lines", data: { start: 1 } }, "image"),
    undefined,
  );
});

test("Only explicit supported heading and video targets become navigable; unknown anchors remain data", () => {
  assert.deepEqual(
    attachmentAnchorTarget(
      { type: "md-section", data: { headingId: "attachment-section-2" } },
      "markdown",
    ),
    { kind: "heading", id: "attachment-section-2" },
  );
  assert.deepEqual(
    attachmentAnchorTarget(
      { type: "video-timestamp", data: { time: 12.345 } },
      "video",
    ),
    { kind: "time", seconds: 12.345 },
  );
  for (const anchor of [
    { type: "video-timestamp", data: { time: -2 } },
    { type: "html-region", data: { y: 10 } },
    { type: "future-anchor", data: { selector: "body" } },
  ])
    assert.equal(attachmentAnchorTarget(anchor, "video"), undefined);
  assert.equal(
    attachmentAnchorLabel({ type: "lines", data: { start: 2, end: 4 } }),
    "第 2–4 行",
  );
  assert.equal(
    attachmentAnchorLabel({
      type: "md-section",
      data: { headingId: "h", headingTitle: "方案" },
    }),
    "§ 方案",
  );
});

test("File comments read oldest to newest regardless of their file anchor", () => {
  const comments = [
    {
      id: "reply",
      roomSeq: 13,
      createdAt: "2026-09-14T01:32:00Z",
      anchor: null,
    },
    {
      id: "question",
      roomSeq: 12,
      createdAt: "2026-09-14T01:22:00Z",
      anchor: { type: "md-section", data: { headingId: "section-4" } },
    },
    {
      id: "earliest",
      roomSeq: 11,
      createdAt: "2026-09-14T01:12:00Z",
      anchor: { type: "lines", data: { start: 100 } },
    },
  ];
  const original = structuredClone(comments);
  assert.deepEqual(
    orderAttachmentComments(comments).map((c) => c.id),
    ["earliest", "question", "reply"],
  );
  assert.deepEqual(comments, original);
});

test("Equal comment times use durable Room order, including equivalent time zones", () => {
  const comments = [
    { id: "second", roomSeq: 21, createdAt: "2026-09-14T09:22:00+08:00" },
    { id: "first", roomSeq: 20, createdAt: "2026-09-14T01:22:00Z" },
    { id: "later", roomSeq: 22, createdAt: "2026-09-14T01:23:00Z" },
  ];
  assert.deepEqual(
    orderAttachmentComments(comments).map((c) => c.id),
    ["first", "second", "later"],
  );
});
