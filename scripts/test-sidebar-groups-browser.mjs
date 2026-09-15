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
  const groups = p.locator("[data-sidebar-group]");
  await expect(groups).toHaveCount(3);
  const header = (id) =>
    p.locator(`[data-sidebar-group="${id}"] .rah-sidebar-disclosure`);
  for (const id of ["pinned", "channels", "dms"]) {
    await header(id).click({ button: "right" });
    await expect(p.getByRole("menuitem", { name: "删除分区" })).toHaveCount(0);
    await expect(
      p.getByRole("menuitem", { name: "重命名 / 更换图标…" }),
    ).toHaveCount(0);
    await p.keyboard.press("Escape");
  }
  await header("channels").click({ button: "right" });
  await p.getByRole("menuitem", { name: "新建分区…", exact: true }).click();
  const dialog = p.getByRole("dialog", { name: "新建分区", exact: true });
  await dialog.getByRole("button", { name: "选择分区表情" }).click();
  await p.keyboard.press("Escape");
  await dialog.getByPlaceholder("我的项目").fill("111");
  await dialog.getByRole("button", { name: "创建分区", exact: true }).click();
  await expect(groups).toHaveCount(4);
  const custom = groups.filter({ has: p.getByText("111", { exact: true }) });
  await expect(custom.getByText("暂无会话")).toBeHidden();
  const id = await custom.getAttribute("data-sidebar-group");
  assert.equal(
    await custom.evaluate((el) => getComputedStyle(el).marginTop),
    "12px",
  );
  await header(id).click({ button: "right" });
  await expect(p.getByRole("menuitem", { name: "隐藏空的分区" })).toHaveCount(
    0,
  );
  await p.getByRole("menuitem", { name: "重命名 / 更换图标…" }).click();
  const edit = p.getByRole("dialog", {
    name: "重命名 / 更换图标",
    exact: true,
  });
  await expect(edit.getByPlaceholder("我的项目")).toHaveValue("111");
  await edit.getByPlaceholder("我的项目").fill("工作");
  await edit.getByRole("button", { name: "保存", exact: true }).click();
  await expect(header(id)).toContainText("工作");
  async function drag(source, target, cancel = false) {
    const sourceKey = await source.getAttribute("data-sidebar-key");
    const sourceGroup = await source.evaluate((el) =>
      el.closest("[data-sidebar-group]").getAttribute("data-sidebar-group"),
    );
    const targetGroup = await target.evaluate((el) =>
      el.closest("[data-sidebar-group]").getAttribute("data-sidebar-group"),
    );
    const a = await source.boundingBox(),
      z = await target.boundingBox();
    assert.ok(a && z);
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await p.mouse.down();
    await p.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 3 });
    await p.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 20 });
    await p.waitForTimeout(250);
    if (
      sourceKey &&
      sourceGroup !== targetGroup &&
      targetGroup.startsWith("custom:")
    ) {
      await expect(
        p.locator(
          `[data-sidebar-group="${targetGroup}"] [data-sidebar-key="${sourceKey}"]`,
        ),
      ).toHaveCount(1);
      await expect(
        p.locator(
          `[data-sidebar-group="${sourceGroup}"] [data-sidebar-key="${sourceKey}"]`,
        ),
      ).toHaveCount(0);
      // Cross-group preview moves the destination when the source row leaves.
      // Release inside its current hit area, not the old pre-preview position.
      const movedTarget = await target.boundingBox();
      await p.mouse.move(
        movedTarget.x + movedTarget.width / 2,
        movedTarget.y + movedTarget.height / 2,
        { steps: 4 },
      );
    }
    const decorations = await p
      .locator(".rah-sidebar-sortable.is-over, .rah-sidebar-drop.is-over")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          outline: getComputedStyle(node).outlineStyle,
          line: getComputedStyle(node, "::after").borderBottomWidth,
        })),
      );
    assert.ok(
      decorations.every((d) => d.outline === "none" && d.line === "0px"),
      "drag feedback uses displacement, not dashed group outlines or item underlines",
    );
    const isGroup = !sourceKey;
    const moving = sourceKey
      ? p.locator(`[data-sidebar-key="${sourceKey}"]`)
      : source;
    const opacity = await moving.evaluate(
      (el) =>
        getComputedStyle(
          el.closest("[data-sidebar-key]") ??
            el.closest("[data-sidebar-group]"),
        ).opacity,
    );
    assert.equal(opacity, isGroup ? "0.6" : "0.12");
    if (isGroup)
      await expect(p.locator(".rah-sidebar-drag-preview")).toHaveCount(0);
    else {
      await expect(p.locator(".rah-sidebar-drag-preview")).toBeVisible();
      assert.match(
        await p
          .locator(".rah-sidebar-drag-preview")
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        /^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/,
      );
    }
    await p.screenshot({
      path: isGroup
        ? "/tmp/rah-sidebar-group-drag-active.png"
        : "/tmp/rah-sidebar-drag-active.png",
    });
    if (cancel) await p.keyboard.press("Escape");
    await p.mouse.up();
    await p.waitForTimeout(350);
  }
  const room = p
    .locator('[data-sidebar-group="channels"] [data-sidebar-key]')
    .first();
  const roomKey = await room.getAttribute("data-sidebar-key");
  await drag(room, p.locator(`[data-sidebar-drop="${id}"]`));
  await expect(
    p.locator(`[data-sidebar-group="${id}"] [data-sidebar-key="${roomKey}"]`),
  ).toHaveCount(1);
  await expect(p.locator(`[data-sidebar-key="${roomKey}"]`)).toHaveCount(1);
  const dm = p.locator('[data-sidebar-group="dms"] [data-sidebar-key]').first();
  const dmKey = await dm.getAttribute("data-sidebar-key");
  await drag(dm, p.locator('[data-sidebar-drop="channels"] .side-title'));
  await expect(
    p.locator(`[data-sidebar-group="dms"] [data-sidebar-key="${dmKey}"]`),
  ).toHaveCount(1);
  await drag(dm, p.locator(`[data-sidebar-drop="${id}"] .side-title`));
  await expect(
    p.locator(`[data-sidebar-group="${id}"] [data-sidebar-key="${dmKey}"]`),
  ).toHaveCount(1);
  await expect(p.locator(`[data-sidebar-key="${dmKey}"]`)).toHaveCount(1);
  // Collapse before group sorting so every pointer target fits in the viewport.
  for (const group of await groups.all()) {
    const h = group.locator(".rah-sidebar-disclosure");
    if ((await h.getAttribute("aria-expanded")) === "true") await h.click();
  }
  await drag(header(id), header("pinned"));
  await expect(groups.first()).toHaveAttribute("data-sidebar-group", id);
  await p.reload();
  await expect(groups.first()).toHaveAttribute("data-sidebar-group", id);
  await expect(
    p.locator(`[data-sidebar-group="${id}"] [data-sidebar-key]`),
  ).toHaveCount(2);
  // Reorder within the mixed custom group and persist.
  const entries = p.locator(`[data-sidebar-group="${id}"] [data-sidebar-key]`);
  const firstKey = await entries.first().getAttribute("data-sidebar-key");
  await drag(entries.first(), entries.last());
  await expect(entries.last()).toHaveAttribute("data-sidebar-key", firstKey);
  // A slow durable save must not snap the preview back while waiting.
  let releaseSave;
  let patchCalls = 0;
  await p.route("**/sidebar/patch", async (route) => {
    patchCalls++;
    await new Promise((resolve) => {
      releaseSave = resolve;
    });
    await route.continue();
  });
  const slowKey = await entries.first().getAttribute("data-sidebar-key");
  await drag(entries.first(), entries.last());
  await expect(entries.last()).toHaveAttribute("data-sidebar-key", slowKey);
  assert.equal(patchCalls, 1, "preview movement sends only one final write");
  await p.waitForTimeout(500);
  await expect(entries.last()).toHaveAttribute("data-sidebar-key", slowKey);
  const savedResponse = p.waitForResponse((response) =>
    response.url().endsWith("/sidebar/patch"),
  );
  releaseSave();
  await savedResponse;
  await p.unroute("**/sidebar/patch");
  await expect(p.locator("[data-sidebar-key][aria-disabled=true]")).toHaveCount(
    0,
  );
  await p.reload();
  await expect(entries.last()).toHaveAttribute("data-sidebar-key", slowKey);
  // Failed writes restore the confirmed order, rather than leaving fake success.
  const failedFirst = await entries.first().getAttribute("data-sidebar-key");
  await p.route("**/sidebar/patch", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "fixture denied save" }),
    }),
  );
  await drag(entries.first(), entries.last());
  await expect(entries.first()).toHaveAttribute(
    "data-sidebar-key",
    failedFirst,
  );
  await expect(p.getByRole("alert")).toBeVisible();
  await p.unroute("**/sidebar/patch");
  const cancelOrder = await entries.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-sidebar-key")),
  );
  await drag(entries.first(), entries.last(), true);
  assert.deepEqual(
    await entries.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-sidebar-key")),
    ),
    cancelOrder,
  );
  await p.getByRole("button", { name: "已保存", exact: true }).click();
  await p.mouse.move(1000, 700);
  assert.match(
    await p
      .locator(".sidebar-bookmarks.is-selected")
      .evaluate((el) => getComputedStyle(el).borderTopColor),
    /^(rgb\(0, 0, 0\)|oklch\(0 0 0\))$/,
  );
  await p.screenshot({ path: "/tmp/rah-sidebar-groups.png" });
  await header(id).click({ button: "right" });
  await p.getByRole("menuitem", { name: "删除分区", exact: true }).click();
  await expect(groups).toHaveCount(3);
  await expect(
    p.locator(
      `[data-sidebar-group="channels"] [data-sidebar-key="${roomKey}"]`,
    ),
  ).toHaveCount(1);
  await expect(
    p.locator(`[data-sidebar-group="dms"] [data-sidebar-key="${dmKey}"]`),
  ).toHaveCount(1);
  await header("channels").click({ button: "right" });
  await p.getByRole("menuitem", { name: "新建分区…", exact: true }).click();
  await p.setViewportSize({ width: 390, height: 844 });
  const mobileDialog = p.getByRole("dialog", { name: "新建分区", exact: true });
  await expect(
    mobileDialog.getByRole("button", { name: "选择分区表情" }),
  ).toBeVisible();
  const box = await mobileDialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await p.screenshot({ path: "/tmp/rah-sidebar-groups-mobile.png" });
  await p.keyboard.press("Escape");
  console.log(
    "sidebar groups: spacing, empty, edit, protected groups, real pointer movement, single placement, persistence, saved selection passed",
  );
} finally {
  await b.close();
  await f.close();
}
