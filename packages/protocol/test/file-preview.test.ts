import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ATTACHMENT_TEXT_PREVIEW_BYTES,
  classifyAttachmentPreview,
} from "../src/index.ts";

test("attachment preview classification has one bounded cross-layer owner", () => {
  assert.equal(classifyAttachmentPreview("image/png", "diagram.bin"), "image");
  assert.equal(
    classifyAttachmentPreview("text/plain", "decision.md"),
    "markdown",
  );
  assert.equal(
    classifyAttachmentPreview("application/octet-stream", "change.patch"),
    "diff",
  );
  assert.equal(classifyAttachmentPreview("text/plain", "results.csv"), "csv");
  assert.equal(
    classifyAttachmentPreview("application/octet-stream", "report.html"),
    "html",
  );
  assert.equal(
    classifyAttachmentPreview("application/json; charset=utf-8", "payload"),
    "text",
  );
  assert.equal(
    classifyAttachmentPreview("application/octet-stream", "Dockerfile"),
    "text",
  );
  assert.equal(
    classifyAttachmentPreview("image/svg+xml", "unsafe.svg"),
    "text",
    "SVG is source text, never executable image content",
  );
  assert.equal(
    classifyAttachmentPreview("application/pdf", "report.pdf"),
    "pdf",
  );
  assert.equal(
    classifyAttachmentPreview("application/octet-stream", "archive.zip"),
    "unsupported",
  );
  assert.equal(MAX_ATTACHMENT_TEXT_PREVIEW_BYTES, 2 * 1024 * 1024);
});

test("Raft PDF/audio/video dispatch includes known extensions without making archives previewable", () => {
  for (const [mime, filename, kind] of [
    ["application/octet-stream", "report.PDF", "pdf"],
    ["audio/mpeg", "recording", "audio"],
    ["application/octet-stream", "recording.wav", "audio"],
    ["video/webm", "clip", "video"],
    ["application/octet-stream", "clip.mov", "video"],
  ])
    assert.equal(classifyAttachmentPreview(mime!, filename!), kind);
});
