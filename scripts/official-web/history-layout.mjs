import assert from "node:assert/strict";

// Browser-only assertion: a sparse history starts at the top and grows downward.
export async function assertSparseHistoryStartsAtTop(page, expectedBodies) {
  const timeline = page.getByTestId("loom-message-timeline");
  const rows = timeline.locator("[data-timeline-message-id]");
  assert.equal(await rows.count(), expectedBodies.length);
  const bounds = await timeline.boundingBox();
  let previousBottom = bounds.y;
  for (const [index, body] of expectedBodies.entries()) {
    const row = rows.nth(index);
    assert.ok((await row.innerText()).includes(body), "oldest message first");
    const box = await row.boundingBox();
    if (index === 0)
      assert.ok(
        Math.abs(box.y - bounds.y) < 8,
        `sparse history must start at top: offset ${box.y - bounds.y}px`,
      );
    assert.ok(box.y >= previousBottom - 1, "messages grow downward");
    previousBottom = box.y + box.height;
  }
  assert.ok(previousBottom < bounds.y + bounds.height, "fixture is sparse");
}
