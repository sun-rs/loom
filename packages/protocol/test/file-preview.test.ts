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
    "unsupported",
    "protected binary media needs a separate streaming capability contract",
  );
  assert.equal(
    classifyAttachmentPreview("application/octet-stream", "archive.zip"),
    "unsupported",
  );
  assert.equal(MAX_ATTACHMENT_TEXT_PREVIEW_BYTES, 2 * 1024 * 1024);
});
