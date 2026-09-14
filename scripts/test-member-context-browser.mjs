import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture(),
  browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(fixture.origin + "/?surface=agents");
  const row = page
    .locator(
      ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
    )
    .first();
  await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "发消息", exact: true })
    .waitFor({ timeout: 3000 });
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), [
    "发消息",
    "停止",
    "重启 / 重置",
  ]);
  const hovered = page.getByRole("menuitem", { name: "发消息", exact: true });
  await hovered.hover();
  assert.equal(
    await hovered.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(255, 212, 64, 0.3)",
  );
  await page.screenshot({ path: "/tmp/rah-member-context.png" });
  assert.equal(
    Math.round((await page.getByRole("menu").boundingBox()).width),
    192,
  );
  await page.getByRole("menuitem", { name: "停止", exact: true }).click();
  await page.getByRole("dialog", { name: "停止 Agent", exact: true }).waitFor();
  const stop = page.getByRole("dialog", { name: "停止 Agent", exact: true });
  assert.equal((await stop.boundingBox()).width, 384, "Raft zi max-w-sm");
  assert.equal(
    await stop
      .locator("header")
      .evaluate((el) => getComputedStyle(el).borderBottomWidth),
    "0px",
  );
  assert.equal(
    (
      await stop
        .getByRole("button", { name: "关闭", exact: true })
        .boundingBox()
    ).width,
    32,
  );
  const confirm = stop.getByRole("button", { name: "停止 Agent", exact: true });
  assert.equal((await confirm.boundingBox()).height, 28);
  assert.equal(
    await confirm.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(248, 161, 111)",
  );
  assert.match(
    await stop.innerText(),
    /确定要停止“.+”吗？该 Agent 将停止处理消息。/u,
  );
  await page.screenshot({ path: "/tmp/rah-member-stop-parity.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal((await stop.boundingBox()).width, 358);
  await page.screenshot({ path: "/tmp/rah-member-stop-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "取消", exact: true }).click();
  for (const close of ["escape", "outside"]) {
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "停止", exact: true }).click();
    await stop.waitFor();
    assert.equal(
      await stop.evaluate((el) => el.contains(document.activeElement)),
      true,
    );
    if (close === "escape") await page.keyboard.press("Escape");
    else
      await page
        .getByRole("button", { name: "关闭 Agent 操作窗口", exact: true })
        .click({ position: { x: 8, y: 8 } });
    await stop.waitFor({ state: "hidden" });
  }

  await row.click({ button: "right" });
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await row.press("Shift+F10");
  await page.getByRole("menu").waitFor();
  await page.keyboard.press("Escape");
  const second = page
    .locator(
      ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
    )
    .nth(1);
  const targetName = await second.locator("b").innerText();
  await second.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "重启 / 重置", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  assert.ok((await page.getByRole("dialog").innerText()).includes(targetName));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  console.log(
    "member context menu, existing confirmation, Escape and keyboard passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
