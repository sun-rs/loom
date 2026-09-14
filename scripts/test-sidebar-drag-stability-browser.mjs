import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await (
    process.env.RAH_SIDEBAR_ENGINE === "firefox" ? firefox : chromium
  ).launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(f.origin);
  const group = p.locator('[data-sidebar-group="dms"]');
  const rows = group.locator("[data-sidebar-key]");
  await expect(rows).toHaveCount(2);
  const order = await rows.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-sidebar-key")),
  );
  const a = await rows.first().boundingBox(),
    z = await rows.last().boundingBox();
  await group.evaluate((el) => {
    window.dragChanges = 0;
    window.dragObserver = new MutationObserver(
      (records) =>
        (window.dragChanges += records.filter(
          (r) =>
            r.type === "childList" &&
            [...r.addedNodes, ...r.removedNodes].some(
              (n) => n instanceof Element && n.hasAttribute("data-sidebar-key"),
            ),
        ).length),
    );
    window.dragObserver.observe(el, { subtree: true, childList: true });
  });
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 3 });
  await p.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 30 });
  for (let pass = 0; pass < 3; pass++) {
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 15 });
    await p.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 15 });
  }
  await p.waitForTimeout(300);
  const displaced = await p
    .locator(`[data-sidebar-key="${order[1]}"]`)
    .boundingBox();
  assert.ok(
    displaced.y < z.y - 5,
    "the neighbor still moves aside while pointer is held",
  );
  const mutations = await p.evaluate(() => window.dragChanges);
  console.log("same-group DOM row moves before release:", mutations);
  assert.deepEqual(
    await rows.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-sidebar-key")),
    ),
    order,
    "same-group preview must use transforms, not repeatedly mutate row order",
  );
  assert.equal(
    mutations,
    0,
    "no DOM reorder/measurement feedback during same-group drag",
  );
  await p.mouse.up();
  await expect(rows.first()).toHaveAttribute("data-sidebar-key", order[1]);
  await expect(rows.last()).toHaveAttribute("data-sidebar-key", order[0]);
  await p.reload();
  await expect(rows.first()).toHaveAttribute("data-sidebar-key", order[1]);
  console.log(
    "stable DOM, visible neighbor displacement, drop order and persistence passed",
  );
} finally {
  await b.close();
  await f.close();
}
