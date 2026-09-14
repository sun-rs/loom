import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(f.origin + "/?surface=agents");
  await p
    .locator(
      ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
    )
    .first()
    .click();
  const header = p.locator(".rah-agent-detail-head");
  // Resize the actual container, independently of the wide browser viewport.
  await header.evaluate(
    (el) => ((el.style.boxSizing = "content-box"), (el.style.width = "480px")),
  );
  const more = header.getByRole("button", { name: "更多操作", exact: true });
  await more.waitFor({ timeout: 2000 });
  assert.equal(
    await header
      .getByRole("button", { name: "停止 Agent", exact: true })
      .isVisible(),
    false,
  );
  await more.click();
  const menu = p.getByRole("menu", { name: "更多操作" });
  await menu.waitFor({ timeout: 3000 }).catch(async (e) => {
    await p.screenshot({ path: "/tmp/rah-header-failure.png" });
    await p.setViewportSize({ width: 390, height: 844 });
    await header.evaluate((el) => {
      el.style.removeProperty("width");
      el.style.removeProperty("box-sizing");
    });
    await more.waitFor();
    await more.click();
    await menu.waitFor();
    const mobileMenu = await menu.boundingBox();
    assert.ok(mobileMenu.x >= 0 && mobileMenu.x + mobileMenu.width <= 390);
    await p.screenshot({ path: "/tmp/rah-agent-header-mobile.png" });
    await p.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    console.log(
      await p
        .locator("[role=menu]")
        .evaluateAll((es) => es.map((e) => e.outerHTML)),
    );
    throw e;
  });
  assert.equal(await menu.getByRole("menuitem").count(), 3);
  assert.equal(
    await menu
      .getByRole("menuitem")
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
    "0px",
  );
  await p.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await more.focus();
  await p.keyboard.press("Enter");
  await menu.waitFor();
  await menu.getByRole("menuitem", { name: "停止 Agent", exact: true }).click();
  await p.getByRole("dialog").waitFor();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await header.evaluate((el) => (el.style.width = "481px"));
  const stop = header.getByRole("button", { name: "停止 Agent", exact: true });
  await stop.waitFor();
  assert.equal(await more.isVisible(), false);
  await stop.hover();
  const tip = p.getByRole("tooltip", { name: "停止 Agent", exact: true });
  await tip.waitFor();
  const a = await stop.boundingBox(),
    t = await tip.boundingBox();
  assert.ok(t.y >= a.y + a.height);
  await header
    .getByRole("button", { name: "重启 / 重置", exact: true })
    .hover();
  await p.getByRole("tooltip", { name: "重启 / 重置", exact: true }).waitFor();
  await p.screenshot({ path: "/tmp/rah-agent-header-wide.png" });
  await header.evaluate((el) => (el.style.width = "400px"));
  await p
    .getByRole("tooltip", { name: "重启 / 重置", exact: true })
    .waitFor({ state: "hidden", timeout: 2000 });
  await more.click();
  await menu.waitFor();
  await p.screenshot({ path: "/tmp/rah-agent-header-narrow.png" });
  await p.mouse.click(900, 600);
  await menu.waitFor({ state: "hidden" });
  await p.setViewportSize({ width: 390, height: 844 });
  await header.evaluate((el) => {
    el.style.removeProperty("width");
    el.style.removeProperty("box-sizing");
  });
  await more.waitFor();
  await more.click();
  await menu.waitFor();
  const mobileMenu = await menu.boundingBox();
  assert.ok(mobileMenu.x >= 0 && mobileMenu.x + mobileMenu.width <= 390);
  await p.screenshot({ path: "/tmp/rah-agent-header-mobile.png" });
  await p.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  console.log(
    "480/481 container boundary, menu keyboard/action/outside dismissal, bottom tooltip and adjacent pointer targets passed",
  );
} finally {
  await b.close();
  await f.close();
}
