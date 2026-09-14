import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const engine = process.env.RAH_BROWSER === "firefox" ? firefox : chromium;
const b = await engine.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(12000);
  await p.goto(f.origin);
  const plus = p.getByRole("button", { name: "新建频道", exact: true });
  for (const entry of ["plus", "context"]) {
    if (entry === "plus") await plus.click();
    else {
      const box = await p
        .locator(".rah-room-sidebar .sidebar-body")
        .boundingBox();
      await p.mouse.click(box.x + box.width / 2, box.y + box.height - 5, {
        button: "right",
      });
      await p.getByRole("menuitem", { name: "创建频道", exact: true }).click();
    }
    const d = p.getByRole("dialog", { name: "创建频道", exact: true });
    await d.waitFor();
    const css = await d.evaluate((el) => {
      const s = getComputedStyle(el),
        h = getComputedStyle(el.querySelector("header")),
        i = getComputedStyle(el.querySelector("input")),
        foot = getComputedStyle(el.querySelector("footer"));
      return {
        width: el.getBoundingClientRect().width,
        padding: s.paddingTop,
        headerBorder: h.borderBottomWidth,
        inputFont: i.fontSize,
        footerPosition: foot.position,
        footerGap: foot.gap,
      };
    });
    assert.deepEqual(css, {
      width: 448,
      padding: "24px",
      headerBorder: "0px",
      inputFont: "16px",
      footerPosition: "static",
      footerGap: "12px",
    });
    await expect(d.locator("label").first().locator("span")).toHaveText(
      "名称 *",
    );
    await expect(d.locator("textarea")).toHaveAttribute("rows", "2");
    await expect(d.locator(".rah-room-visibility svg")).toHaveCount(2);
    await expect(d.locator(".rah-room-create-member-search svg")).toHaveCount(
      1,
    );
    await expect(d.locator(".rah-room-create-agent-list small")).toHaveCount(0);
    await expect(d.locator(".rah-agent-status-dot")).toHaveCount(0);
    const row = d.locator(".rah-room-create-agent-list > button").first();
    await row.hover();
    await expect
      .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(255, 212, 64)");
    await p.screenshot({
      path: `/tmp/rah-room-create-${engine.name()}-${entry}-hover.png`,
    });
    await d.getByRole("heading", { name: "创建频道", exact: true }).hover();
    await expect
      .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgba(0, 0, 0, 0)");
    await row.click();
    await expect(row).toHaveAttribute("aria-pressed", "true");
    const selectedColor = await row.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    assert.notEqual(selectedColor, "rgb(255, 212, 64)");
    await d.getByRole("heading", { name: "创建频道", exact: true }).hover();
    assert.equal(
      await row.evaluate((el) => getComputedStyle(el).backgroundColor),
      selectedColor,
    );
    await row.hover();
    assert.equal(
      await row.evaluate((el) => getComputedStyle(el).backgroundColor),
      selectedColor,
    );
    await row.click();
    await expect(row).toHaveAttribute("aria-pressed", "false");
    await d.getByRole("searchbox", { name: "搜索成员" }).fill("no-such-member");
    await expect(d.getByText("没有匹配的 Agent。")).toBeVisible();
    await d.getByRole("searchbox", { name: "搜索成员" }).fill("");
    await p.screenshot({
      path: `/tmp/rah-room-create-${engine.name()}-${entry}.png`,
    });
    await p.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
  }
  await plus.click();
  const d = p.getByRole("dialog", { name: "创建频道", exact: true });
  await d
    .getByPlaceholder("例如 ai-research")
    .fill("Isolated channel creation fixture");
  await d.getByRole("radio", { name: "私密" }).click();
  await p.route("**/v3/client/rooms/create", (r) =>
    r.fulfill({
      status: 503,
      json: { error: { message: "isolated failure" } },
    }),
  );
  await d.getByRole("button", { name: "创建频道", exact: true }).click();
  await expect(d.locator(".rah-dialog-error")).toBeVisible();
  await expect(d.getByPlaceholder("例如 ai-research")).toHaveValue(
    "Isolated channel creation fixture",
  );
  await p.unroute("**/v3/client/rooms/create");
  await p.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      d.evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
    )
    .toBe(true);
  await d
    .getByRole("button", { name: "创建频道", exact: true })
    .scrollIntoViewIfNeeded();
  await p.screenshot({
    path: `/tmp/rah-room-create-${engine.name()}-mobile.png`,
  });
  await d.getByRole("button", { name: "创建频道", exact: true }).click();
  await expect(d).toHaveCount(0);
  console.log(
    engine.name(),
    "both entrypoints, source geometry, selection/search, failure recovery, mobile and create passed",
  );
} finally {
  await b.close();
  await f.close();
}
