// Temporary real Core + fake runtime only. Actual mouse gestures, no provider calls.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
export async function verifySidebarDrag({
  browser,
  origin,
  client,
  workspace,
  channels,
}) {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
    }),
    page = await context.newPage();
  const errors = [],
    writes = [];
  let duringDragRows;
  let releaseDrop = () => {};
  page.setDefaultTimeout(6000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/sidebar/patch")) writes.push(r.postDataJSON());
  });
  const getPrefs = async () =>
    (
      await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      })
    ).preferences;
  const patch = async (value) =>
    client.request("sidebar.patch", {
      workspaceId: workspace.workspaceId,
      expectedVersion: (await getPrefs()).version,
      idempotencyKey: crypto.randomUUID(),
      patch: value,
    });
  const open = async () => {
    await page.goto(origin + "/?view=channels");
    await page
      .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
      .waitFor();
  };
  const pinned = page.locator('[data-testid="sidebar-section-block-pinned"]');
  const channelSection = page.locator(
    '[data-testid="sidebar-section-block-channels"]',
  );
  const row = (id) => page.locator(`[data-public-channel-id="${id}"]`);
  async function start(id) {
    const b = await row(id).boundingBox();
    await page.mouse.move(b.x + 100, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 110, b.y + b.height / 2, { steps: 4 });
    await page.getByTestId("sidebar-drag-overlay").waitFor();
  }
  const dropZone = () =>
    pinned
      .locator('[data-sidebar-dnd-container], [data-slot="sidebar-list"]')
      .first();
  try {
    await patch({
      pinned: [],
      pinnedSortMode: "manual",
      channelSortMode: "manual",
      customSections: [{ id: "fixture", name: "Work", items: [] }],
    });
    await open();
    if (process.env.LOOM_SIDEBAR_DND_STAGE !== "drag") {
      const hint = page.getByTestId("sidebar-pinned-empty-hint");
      await hint.waitFor();
      assert.equal((await hint.innerText()).trim(), "将频道或私信拖到这里置顶");
      const frame = await hint.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          p = el.parentElement.getBoundingClientRect();
        return {
          height: r.height,
          parentHeight: p.height,
          marginBottom: getComputedStyle(el).marginBottom,
          paddingTop: getComputedStyle(el).paddingTop,
        };
      });
      assert.equal(frame.height, 36);
      assert.equal(frame.parentHeight, 56);
      assert.equal(frame.marginBottom, "4px");
      assert.equal(frame.paddingTop, "6px");
      const toggle = pinned.locator("[data-section-handle]");
      await toggle.click();
      assert.equal(await hint.isVisible(), false);
      await toggle.click();
      await hint.waitFor();
    }
    // A recent/az SOURCE must still be draggable into the manual pinned target.
    await patch({ channelSortMode: "recent" });
    await open();
    const location = page.url();
    await start(channels[1].roomId);
    const target = await dropZone().boundingBox();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 18 },
    );
    await pinned
      .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
      .waitFor();
    const beforeDropTop = (
      await pinned
        .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
        .boundingBox()
    ).y;
    assert.equal(
      await page.getByTestId("sidebar-pinned-empty-hint").count(),
      0,
      "live projection replaces hint with a row",
    );
    duringDragRows = await page
      .locator("[data-sidebar-dnd-container]")
      .evaluateAll((zones) =>
        zones.map((zone) => ({
          id: zone.getAttribute("data-sidebar-dnd-container"),
          height: zone.getBoundingClientRect().height,
          gap: getComputedStyle(zone).gap,
          rows: [...zone.querySelectorAll("[data-sidebar-drag-item]")].map(
            (row) => ({
              id: row.getAttribute("data-sidebar-drag-item"),
              top: row.getBoundingClientRect().top,
              height: row.getBoundingClientRect().height,
              style: row.getAttribute("style"),
              display: getComputedStyle(row).display,
              margin: getComputedStyle(row).margin,
              transform: getComputedStyle(row).transform,
              flex: getComputedStyle(row).flex,
            }),
          ),
        })),
      );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[data-sidebar-drag-item]")].every((row) =>
        row
          .getAnimations()
          .every((animation) => animation.playState !== "running"),
      ),
    );
    await page.screenshot({ path: "/tmp/loom-sidebar-live-drag.png" });
    const gate = new Promise((resolve) => {
      releaseDrop = resolve;
    });
    await page.route(
      "**/v3/client/sidebar/patch",
      async (route) => {
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    const accepted = page.waitForResponse(
      (r) => r.url().endsWith("/sidebar/patch") && r.status() === 200,
    );
    accepted.catch(() => {});
    await page.mouse.up();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await pinned
        .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
        .count(),
      1,
      "drop preview must not snap back while the confirmed write response is in flight",
    );
    assert.equal(
      (
        await pinned
          .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
          .boundingBox()
      ).y,
      beforeDropTop,
      "pending feedback must not push the entire sidebar downward",
    );
    releaseDrop();
    await accepted;
    assert.equal(page.url(), location, "dragging must not open a conversation");
    assert.equal(writes.length, 1);
    assert.ok((await getPrefs()).pinned.includes("room:" + channels[1].roomId));
    await page.reload();
    await pinned
      .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
      .waitFor();
    // Manual destination, cross-group drop restores the empty pinned hint.
    await patch({ channelSortMode: "manual" });
    await page.reload();
    await pinned
      .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
      .waitFor();
    await start(channels[1].roomId);
    const dest = await channelSection
      .locator("[data-public-channel-id]")
      .first()
      .boundingBox();
    await page.mouse.move(dest.x + 100, dest.y + dest.height - 2, {
      steps: 18,
    });
    const restored = page.waitForResponse(
      (r) => r.url().endsWith("/sidebar/patch") && r.status() === 200,
    );
    await page.mouse.up();
    await restored;
    await page.getByTestId("sidebar-pinned-empty-hint").waitFor();
    assert.equal((await getPrefs()).pinned.length, 0);
    // Escape discards the projection, never a durable write.
    const before = writes.length;
    await start(channels[0].roomId);
    const empty = await dropZone().boundingBox();
    await page.mouse.move(empty.x + 100, empty.y + empty.height / 2, {
      steps: 15,
    });
    await pinned
      .locator(`[data-public-channel-id="${channels[0].roomId}"]`)
      .waitFor();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.getByTestId("sidebar-pinned-empty-hint").waitFor();
    assert.equal(writes.length, before);
    assert.equal((await getPrefs()).pinned.length, 0);
    // A real protocol refusal rolls presentation back; no extra mutation owner.
    await page.route(
      "**/v3/client/sidebar/patch",
      async (route) => {
        const body = route.request().postDataJSON();
        const response = await route.fetch({
          postData: JSON.stringify({ ...body, expectedVersion: -1 }),
        });
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await start(channels[1].roomId);
    const rejectedBox = await dropZone().boundingBox();
    await page.mouse.move(
      rejectedBox.x + 100,
      rejectedBox.y + rejectedBox.height / 2,
      { steps: 15 },
    );
    await page.mouse.up();
    await page
      .getByText("操作未成功，已刷新列表设置；请检查后重新操作。", {
        exact: true,
      })
      .waitFor();
    await page.getByTestId("sidebar-pinned-empty-hint").waitFor();
    assert.equal((await getPrefs()).pinned.length, 0);
    // Preserve native context menu after moving listeners to the native row.
    await row(channels[1].roomId).click({ button: "right" });
    await page.getByRole("menuitem", { name: "置顶", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    // Real same-list sorting and an empty custom destination, both durable.
    const original = await channelSection
      .locator("[data-public-channel-id]")
      .evaluateAll((es) => es.map((e) => e.dataset.publicChannelId));
    await start(original.at(-1));
    const first = await row(original[0]).boundingBox();
    await page.mouse.move(first.x + 100, first.y + 2, { steps: 16 });
    const sorted = page.waitForResponse(
      (r) => r.url().endsWith("/sidebar/patch") && r.status() === 200,
    );
    await page.mouse.up();
    await sorted;
    assert.equal((await getPrefs()).channelOrder[0], "room:" + original.at(-1));
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(
            '[data-testid="sidebar-section-block-channels"] [data-public-channel-id]',
          )
          ?.getAttribute("data-public-channel-id") === id,
      original.at(-1),
    );
    const custom = page.getByTestId("sidebar-section-block-custom:fixture");
    await start(channels[0].roomId);
    const cb = await custom
      .locator("[data-sidebar-dnd-container]")
      .boundingBox();
    await page.mouse.move(cb.x + 100, cb.y + cb.height / 2, { steps: 15 });
    const placed = page.waitForResponse(
      (r) => r.url().endsWith("/sidebar/patch") && r.status() === 200,
    );
    await page.mouse.up();
    await placed;
    assert.ok(
      (await getPrefs()).customSections[0].items.includes(
        "room:" + channels[0].roomId,
      ),
    );
    // Native section handle moves whole groups; no click-collapse during drag.
    const handle = await custom.locator("[data-section-handle]").boundingBox(),
      sectionBox = await channelSection.boundingBox();
    await page.mouse.move(handle.x + 30, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + handle.height / 2, {
      steps: 4,
    });
    await page.mouse.move(
      sectionBox.x + 40,
      sectionBox.y + sectionBox.height / 2,
      { steps: 18 },
    );
    const grouped = page.waitForResponse(
      (r) => r.url().endsWith("/sidebar/patch") && r.status() === 200,
    );
    await page.mouse.up();
    await grouped;
    const order = (await getPrefs()).sectionOrder;
    assert.ok(order.indexOf("custom:fixture") < order.indexOf("channels"));
    await page.reload();
    await custom
      .locator(`[data-public-channel-id="${channels[0].roomId}"]`)
      .waitFor();
    // Standalone Room presentation uses the same native row/zone machinery.
    await patch({ dmOrder: ["room:" + channels[2].roomId] });
    await page.reload();
    const dm = page.getByTestId("sidebar-section-block-dms");
    const dragDm = async (target) => {
      const from = await page
        .locator(`[data-sidebar-drag-item="${channels[2].roomId}"]`)
        .boundingBox();
      await page.mouse.move(from.x + 100, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 110, from.y + from.height / 2, {
        steps: 4,
      });
      await page.getByTestId("sidebar-drag-overlay").waitFor();
      const to = await target.boundingBox();
      await page.mouse.move(to.x + 100, to.y + to.height / 2, { steps: 16 });
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/sidebar/patch") && r.status() === 200,
      );
      await page.mouse.up();
      await response;
    };
    await dm.locator("[data-sidebar-drag-item]").waitFor();
    await dragDm(dropZone());
    assert.ok((await getPrefs()).pinned.includes("room:" + channels[2].roomId));
    await pinned.locator("[data-sidebar-drag-item]").waitFor();
    await dragDm(dm.locator("[data-sidebar-dnd-container]"));
    await page.getByTestId("sidebar-pinned-empty-hint").waitFor();
    assert.ok(
      (await getPrefs()).dmOrder.includes("room:" + channels[2].roomId),
    );
    assert.equal((await getPrefs()).pinned.length, 0);
    // The full native visibility predicate reveals empty destinations for a drag.
    await page.evaluate(() =>
      localStorage.setItem("slock:sidebarHideEmptySections", "true"),
    );
    await page.reload();
    await row(channels[1].roomId).waitFor();
    assert.equal(await pinned.count(), 0);
    const count = writes.length;
    await start(channels[1].roomId);
    await page.getByTestId("sidebar-pinned-empty-hint").waitFor();
    const reveal = await dropZone().boundingBox();
    await page.mouse.move(reveal.x + 100, reveal.y + reveal.height / 2, {
      steps: 16,
    });
    await pinned
      .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
      .waitFor();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await pinned.waitFor({ state: "hidden" });
    assert.equal(writes.length, count);
    assert.deepEqual(errors, []);
    return {
      browser: browser.browserType().name(),
      emptyHint: true,
      emptyPinnedHeight: 56,
      sourceRecentCanPin: true,
      liveProjection: true,
      dragOverlay: true,
      noSnapWhileWaiting: true,
      oneWritePerDrop: true,
      persistence: true,
      cancelDoesNotWrite: true,
      rejectionRollsBack: true,
      contextMenu: true,
      sameListSort: true,
      emptyCustomDrop: true,
      sectionHandleDrag: true,
      standaloneDmDrop: true,
      hiddenEmptyTargetRevealed: true,
      duringDragRows,
      errors,
    };
  } catch (e) {
    await page.screenshot({ path: "/tmp/loom-sidebar-drag-failure.png" });
    writeFileSync("/tmp/loom-sidebar-drag-failure.html", await page.content());
    writeFileSync(
      "/tmp/loom-sidebar-drag-failure.json",
      JSON.stringify(
        { errors, writes, preferences: await getPrefs() },
        null,
        2,
      ),
    );
    throw e;
  } finally {
    releaseDrop();
    await context.close();
  }
}
