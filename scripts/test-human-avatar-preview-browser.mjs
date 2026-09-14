import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(12000);
  await p.goto(f.origin + "/?room=" + f.roomId);
  const avatar = p
    .locator('[data-message-id] button[aria-label="查看 sun 资料"]')
    .first();
  await avatar.hover();
  const card = p.locator(".rah-human-preview");
  await card.waitFor();
  await card.locator(".rah-profile-identity").waitFor();
  assert.equal((await card.boundingBox()).width, 280);
  const metrics = await card.evaluate((el) => {
    const id = el.querySelector(".rah-profile-identity"),
      image = id.querySelector('[role="img"]');
    return {
      padding: getComputedStyle(id).padding,
      gap: getComputedStyle(id).gap,
      avatar: image.getBoundingClientRect().width,
      name: getComputedStyle(id.querySelector("h2")).fontSize,
      handle: getComputedStyle(id.querySelector("p")).fontSize,
    };
  });
  assert.deepEqual(metrics, {
    padding: "12px",
    gap: "12px",
    avatar: 48,
    name: "14px",
    handle: "12px",
  });
  await p.screenshot({ path: "/tmp/rah-human-preview.png" });
  await p.setViewportSize({ width: 390, height: 844 });
  await avatar.hover();
  await card.waitFor();
  const mobileBox = await card.boundingBox();
  assert.equal(mobileBox.width, 280);
  assert.ok(mobileBox.x >= 6 && mobileBox.x + mobileBox.width <= 384);
  await p.screenshot({ path: "/tmp/rah-human-preview-mobile.png" });
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.mouse.move(1400, 850);
  await card.waitFor({ state: "hidden" });
  await avatar.focus();
  await card.waitFor();
  await p.keyboard.press("Escape");
  await card.waitFor({ state: "hidden" });
  await avatar.hover();
  await card.waitFor();
  await avatar.click();
  await card.waitFor({ state: "hidden" });
  await p.getByRole("main", { name: "Human 详情侧栏" }).waitFor();
  console.log(
    "human preview source metrics, pointer exit, focus/Escape and click inspector passed",
  );
} finally {
  await b.close();
  await f.close();
}
