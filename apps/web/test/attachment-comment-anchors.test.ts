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

test("Comment presentation orders anchors while preserving canonical IDs and original input", () => {
  const comments = [
    {
      id: "last",
      createdAt: "2026-09-08T00:00:03Z",
      anchor: { type: "lines", data: { start: 3 } },
    },
    { id: "whole", createdAt: "2026-09-08T00:00:01Z", anchor: null },
    {
      id: "first",
      createdAt: "2026-09-08T00:00:02Z",
      anchor: { type: "lines", data: { start: 1 } },
    },
  ];
  assert.deepEqual(
    orderAttachmentComments(comments).map((c) => c.id),
    ["whole", "first", "last"],
  );
  assert.equal(comments[0]!.id, "last");
});
