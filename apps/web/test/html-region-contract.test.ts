import assert from "node:assert/strict";
import test from "node:test";
import { attachmentAnchorTarget } from "../src/attachment-comment-anchors.ts";

test("HTML regions validate bounded coordinates before entering the preview bridge", () => {
  const data = {
    x: 10,
    y: 20,
    w: 30,
    h: 40,
    viewportWidth: 800,
    documentWidth: 800,
    documentHeight: 2000,
    quote: "Target",
  };
  assert.equal(
    attachmentAnchorTarget({ type: "html-region", data }, "html")?.kind,
    "html-region",
  );
  for (const invalid of [NaN, Infinity, -1, 1e10, "20"]) {
    assert.equal(
      attachmentAnchorTarget(
        { type: "html-region", data: { ...data, y: invalid } },
        "html",
      ),
      undefined,
    );
  }
  assert.equal(
    attachmentAnchorTarget({ type: "html-region", data }, "text"),
    undefined,
  );
});
