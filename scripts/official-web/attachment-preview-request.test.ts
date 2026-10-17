import test from "node:test";
import assert from "node:assert/strict";
import {
  beginAttachmentPreview,
  cancelAttachmentPreview,
} from "../../frontends/raft/loom/attachment-preview-request.ts";
test("a newer attachment click cancels the older preview across message components", () => {
  const first = beginAttachmentPreview();
  const second = beginAttachmentPreview();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  cancelAttachmentPreview(first);
  assert.equal(second.signal.aborted, false);
  cancelAttachmentPreview(second);
  assert.equal(second.signal.aborted, true);
});
