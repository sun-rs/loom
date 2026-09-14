import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  const open = async () => {
    await page
      .getByRole("button", { name: "频道详情与设置", exact: true })
      .click();
  };
  await open();
  const header = page.locator(".rah-channel-settings-header");
  const mainHeader = page.locator(".rah-conversation-head").first();
  assert.equal(
    (await header.boundingBox()).height,
    (await mainHeader.boundingBox()).height,
    "drawer and page share the header track",
  );
  assert.equal(
    await header.locator("h2").evaluate((e) => getComputedStyle(e).fontSize),
    "16px",
  );

  await page.setViewportSize({ width: 1098, height: 1172 });
  const originalDescription = await page
    .locator("#rah-channel-description")
    .inputValue();
  await page.locator("#rah-channel-description").fill("2222");
  await page.waitForTimeout(260);
  const title = await header.locator("h2").boundingBox();
  const description = await header.locator("p").boundingBox();
  assert.equal(title.y, 12);
  assert.equal(title.height, 20);
  assert.equal(description.y, 32);
  assert.equal(description.height, 16);
  assert.equal(
    (await page.locator(".rah-channel-settings-drawer").boundingBox()).width,
    544,
  );
  const label = await header.locator("h2 > span").boundingBox(),
    badge = await header.locator("h2 > b").boundingBox();
  assert.equal(badge.x - label.x - label.width, 8);
  await page.screenshot({ path: "/tmp/rah-channel-title-measured.png" });
  await page.locator("#rah-channel-description").fill(originalDescription);
  await page.setViewportSize({ width: 1440, height: 500 });
  assert.equal(
    (await header.boundingBox()).height,
    (await mainHeader.boundingBox()).height,
    "short-height viewport shares the compact header track",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const textareaBox = await page
    .locator("#rah-channel-description")
    .boundingBox();
  const footerBox = await page
    .locator(".rah-channel-settings-info footer")
    .boundingBox();
  assert.equal(footerBox.y - textareaBox.y - textareaBox.height, 12);
  const pin = page.getByRole("checkbox", { name: "置顶频道", exact: true });
  await pin.locator("..").click();
  await page.waitForFunction(
    () => !document.querySelector('input[aria-label="置顶频道"]').disabled,
  );
  assert.equal(await pin.isChecked(), true);
  const paint = await pin.evaluate((el) => ({
    opacity: getComputedStyle(el.nextElementSibling).opacity,
    bg: getComputedStyle(el.nextElementSibling).backgroundColor,
    left: getComputedStyle(el.nextElementSibling, "::after").left,
  }));
  assert.equal(paint.opacity, "1", "enabled switch must not look disabled");
  assert.equal(paint.left, "17px", "checked switch thumb must move");
  assert.equal(
    await page.getByRole("checkbox", { name: "通知所有新消息" }).count(),
    0,
  );
  const mute = page.getByRole("checkbox", { name: "静音活动", exact: true });
  await mute.locator("..").click();
  await page.waitForFunction(
    () => !document.querySelector('input[aria-label="静音活动"]').disabled,
  );
  await page.reload();
  await open();
  assert.equal(await pin.isChecked(), true, "pin survives reload");
  assert.equal(await mute.isChecked(), true, "mute survives reload");
  const visibility = page.locator(".rah-channel-visibility-button");
  const original = await visibility.innerText();
  await visibility.click();
  let dialog = page.locator(".rah-room-visibility-confirm");
  await page.screenshot({ path: "/tmp/rah-channel-visibility-parity.png" });
  const modal = dialog.getByRole("dialog");
  assert.equal((await modal.boundingBox()).width, 384);
  assert.equal(
    await modal
      .locator("header")
      .evaluate((el) => getComputedStyle(el).borderBottomWidth),
    "0px",
  );
  assert.equal(
    (
      await modal
        .getByRole("button", { name: "关闭", exact: true })
        .boundingBox()
    ).width,
    32,
  );
  assert.equal(
    (
      await modal
        .getByRole("button", { name: "取消", exact: true })
        .boundingBox()
    ).height,
    28,
  );

  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    await visibility.innerText(),
    original,
    "cancel does not mutate visibility",
  );
  await visibility.click();
  const updateUrl = `${fixture.origin}/v3/client/rooms/update`;
  await page.route(updateUrl, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unavailable", message: "Fixture temporary failure" },
      }),
    }),
  );
  await dialog.getByRole("button", { name: /^(公开|私密)$/ }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(
    await visibility.innerText(),
    original,
    "failed visibility update must not appear saved",
  );
  await page.unroute(updateUrl);
  await dialog.getByRole("button", { name: /^(公开|私密)$/ }).click();
  await dialog.waitFor({ state: "detached" });
  assert.notEqual(
    await visibility.innerText(),
    original,
    "confirmed visibility is reconciled",
  );
  await page.reload();
  await open();
  assert.notEqual(
    await visibility.innerText(),
    original,
    "visibility survives reload",
  );
  const metrics = await page
    .locator(".rah-channel-settings-info")
    .evaluate((el) => {
      const text = el.querySelector("textarea").getBoundingClientRect(),
        footer = el.querySelector("footer").getBoundingClientRect();
      return footer.top - text.bottom;
    });
  assert.ok(Math.abs(metrics - 12) <= 0.5, `footer gap ${metrics}`);
  for (const action of ["archive", "sos", "delete"]) {
    const trigger = page.locator(".rah-channel-" + action + "-button").first();
    if (!(await trigger.isEnabled())) continue;
    await trigger.click();
    const popup = page.locator(".rah-channel-confirmation");
    await popup.waitFor();
    assert.equal((await popup.boundingBox()).width, 384);
    assert.equal(
      await popup
        .locator("header")
        .evaluate((el) => getComputedStyle(el).borderBottomWidth),
      "0px",
    );
    await page.screenshot({
      path: "/tmp/rah-channel-" + action + "-parity.png",
    });
    await popup.getByRole("button", { name: "关闭", exact: true }).click();
  }

  for (const selector of ["archive", "sos", "leave"])
    assert.equal(
      await page
        .locator(`.rah-channel-${selector}-button`)
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "oklch(1 0 0)",
    );
  assert.equal(
    await page
      .getByText("最后一名所有者需要先把其他 Human 设为所有者", { exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: "/tmp/rah-channel-settings-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "/tmp/rah-channel-settings-mobile.png",
    fullPage: true,
  });
  console.log(
    "PASS pin/mute persisted, switch paint, visibility cancel/confirm/reload, operation colors, spacing, mobile",
  );
} finally {
  await browser.close();
  await fixture.close();
}
