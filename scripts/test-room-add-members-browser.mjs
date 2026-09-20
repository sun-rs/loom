import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(f.origin + "/?room=" + f.roomId);
  await p.getByRole("button", { name: "频道详情与设置", exact: true }).click();
  await p.getByRole("button", { name: "管理成员", exact: true }).click();
  const row = p.locator(".rah-member-row").first();
  await row.hover();
  await row.getByRole("button", { name: /移出/ }).click();
  const confirmation = p.getByRole("dialog", { name: "移除成员", exact: true });
  await confirmation.getByRole("button", { name: "移除", exact: true }).click();
  await confirmation.waitFor({ state: "hidden" });
  await p.getByRole("button", { name: "添加成员", exact: true }).click();
  const candidates = p.locator(".rah-room-member-page.is-add");
  const candidate = candidates.locator(".rah-room-add-candidate").first();
  await candidate.click();
  assert.equal(
    await candidate
      .locator(".rah-room-member-checkbox")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "oklch(0 0 0)",
  );
  assert.equal(await candidates.locator(".rah-room-selected-chip").count(), 1);
  await candidates.locator(".rah-room-selected-chip button").click();
  assert.equal(await candidate.getAttribute("aria-pressed"), "false");
  const createEntry = candidates.getByRole("button", {
    name: /创建一个新 Agent/,
  });
  await createEntry.click();
  const createDialog = p.getByRole("dialog", {
    name: "创建 AGENT",
    exact: true,
  });
  await createDialog.waitFor();
  assert.match(
    await createDialog.locator(".rah-agent-create-channel").innerText(),
    /创建完成后将自动加入 #/,
  );
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 844 });
    const banner = createDialog.locator(".rah-agent-create-channel");
    assert.deepEqual(
      await banner.evaluate((el) => {
        const css = getComputedStyle(el);
        return [
          css.fontSize,
          css.lineHeight,
          css.paddingTop,
          css.paddingRight,
          css.borderTopWidth,
        ];
      }),
      ["12px", "16px", "8px", "12px", "2px"],
    );
    await p.screenshot({ path: `/tmp/create-channel-banner-${width}.png` });
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  await createDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await candidates.waitFor();

  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 844 });
    await candidate.click();
    await p.screenshot({ path: `/tmp/add-member-parity-${width}.png` });
    await candidate.click();
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  await createEntry.click();
  let provisionCount = 0,
    joinCount = 0;
  p.on("request", (request) => {
    if (request.url().endsWith("/agents/provision")) provisionCount++;
  });
  await p.route("**/v3/client/agents/onboard", async (route) => {
    joinCount++;
    if (joinCount === 1)
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "unavailable", message: "Fixture join failed" },
        },
      });
    else await route.continue();
  });
  await createDialog.locator("input").first().fill("NewChannelAgent");
  await createDialog.getByRole("button", { name: /^运行时：/ }).click();
  await p.getByRole("menuitemradio").first().click();
  const model = createDialog.getByRole("button", { name: /^模型：/ });
  await model.click();
  await p
    .getByRole("menuitemradio")
    .filter({ hasNotText: "自定义" })
    .first()
    .click();
  await createDialog
    .getByRole("button", { name: "创建 Agent", exact: true })
    .click();
  await expect(createDialog.getByRole("alert")).toContainText(
    "Fixture join failed",
  );
  assert.equal(provisionCount, 1);
  await createDialog
    .getByRole("button", { name: "重试完成创建", exact: true })
    .click();
  await expect(createDialog).toHaveCount(0);
  assert.equal(provisionCount, 1);
  assert.equal(joinCount, 2);
  await expect(
    candidates.getByRole("button", {
      name: "选择 NewChannelAgent",
      exact: true,
    }),
  ).toHaveCount(0);
  console.log(
    "PASS member selection, chips, reused create dialog and failed join retry without duplicate creation",
  );
} finally {
  await b.close();
  await f.close();
}
