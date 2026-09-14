import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await (process.env.RAH_BROWSER === "firefox" ? firefox : chromium).launch(
    { headless: true },
  );
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(10000);
  await p.goto(f.origin + "/?room=" + f.roomId);
  await p.getByRole("button", { name: "频道详情与设置", exact: true }).click();
  const drawer = p.locator(".rah-channel-settings-drawer");
  assert.equal(
    await drawer.evaluate((el) => getComputedStyle(el).animationDuration),
    "0.24s",
  );
  await p.waitForTimeout(260);
  await p.getByRole("button", { name: "管理成员", exact: true }).click();
  // Raft zg: pointer across the profile row; only the hovered avatar darkens.
  for (const member of [
    drawer.locator(".rah-room-member-human .rah-room-member-entry").first(),
    drawer.locator(".rah-member-row").first(),
  ]) {
    const avatar = member.locator(':scope > [role="img"]');
    const bounds = await member.boundingBox();
    await p.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    assert.equal(
      await member.evaluate((el) => getComputedStyle(el).cursor),
      "pointer",
    );
    assert.equal(
      await avatar.evaluate((el) => getComputedStyle(el).filter),
      "none",
    );
    await avatar.hover();
    assert.equal(
      await avatar.evaluate((el) => getComputedStyle(el).cursor),
      "pointer",
    );
    assert.equal(
      await avatar.evaluate((el) => getComputedStyle(el).filter),
      "brightness(0.9)",
    );
    await p.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    assert.equal(
      await avatar.evaluate((el) => getComputedStyle(el).filter),
      "none",
    );
  }
  const drawerBox = await drawer.boundingBox();
  await drawer
    .getByRole("button", { name: "查看 sun 资料", exact: true })
    .click();
  await p.getByRole("main", { name: "Human 详情侧栏" }).waitFor();
  assert.deepEqual(await drawer.boundingBox(), drawerBox);
  await p.getByRole("button", { name: "返回成员管理", exact: true }).click();

  const page = p.locator(".rah-room-member-page.is-members"),
    search = page.getByRole("textbox", { name: "搜索成员" });
  assert.equal(
    await page
      .locator("summary")
      .first()
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(0, 0, 0)",
  );
  assert.equal(
    await page
      .locator(".rah-room-member-group-count")
      .first()
      .evaluate((el) => getComputedStyle(el).fontWeight),
    "500",
  );
  await search.focus();
  assert.equal(
    await search.evaluate((el) => getComputedStyle(el).outlineStyle),
    "none",
  );
  assert.equal(
    await search.evaluate((el) => getComputedStyle(el).borderTopWidth),
    "2px",
  );
  const add = page.getByRole("button", { name: "添加成员", exact: true });
  const box = await page.boundingBox(),
    ab = await add.boundingBox();
  assert.ok(box.y + box.height - ab.y - ab.height <= 18);
  assert.equal(await page.getByText("成员", { exact: true }).count(), 0);
  assert.equal(await page.getByText("所有者", { exact: true }).count(), 0);
  await page.getByText("频道管理员", { exact: true }).first().waitFor();
  assert.equal(
    (
      await page
        .locator(".rah-room-member-human [role=img]")
        .first()
        .boundingBox()
    ).width,
    28,
  );
  assert.equal(
    (await page.getByText("频道管理员", { exact: true }).first().boundingBox())
      .height,
    18,
  );
  const row = page.locator(".rah-member-row").first(),
    remove = row.getByRole("button", { name: /移出/ });
  assert.equal(await remove.isVisible(), false);
  await row.click();
  await drawer.locator(".rah-agent-profile-pane").waitFor();
  assert.deepEqual(await drawer.boundingBox(), drawerBox);
  await p.getByRole("button", { name: "返回成员管理", exact: true }).click();
  await row.hover();
  await remove.waitFor();
  assert.equal(await remove.innerText(), "移除");
  await p.waitForTimeout(200);
  assert.equal(
    await row.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(255, 212, 64, 0.3)",
  );
  assert.deepEqual(
    await remove.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        paddingLeft: s.paddingLeft,
      };
    }),
    { height: 28, fontSize: "12px", lineHeight: "16px", paddingLeft: "8px" },
  );
  assert.equal((await row.boundingBox()).height, 52);
  assert.equal(
    await row.locator("b").evaluate((el) => getComputedStyle(el).fontSize),
    "14px",
  );
  await p.screenshot({ path: "/tmp/rah-member-row-before-button-hover.png" });
  assert.equal(
    await remove.evaluate((el) => getComputedStyle(el).borderTopWidth),
    "2px",
  );
  assert.equal(
    await remove.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(249, 114, 100, 0.2)",
  );
  await remove.hover();
  await p.waitForTimeout(200);
  assert.equal(
    await remove.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(249, 114, 100, 0.6)",
  );
  await p.screenshot({ path: "/tmp/rah-room-member-hover.png" });
  await remove.click();
  const confirmation = p.getByRole("dialog", { name: "移除成员", exact: true });
  await confirmation.waitFor({ timeout: 2000 });
  assert.match(await confirmation.innerText(), /将停止接收 #[^\n]+ 的常规消息/);
  assert.match(await confirmation.innerText(), /已关注的消息列也不会继续通知/);
  assert.match(await confirmation.innerText(), /已有消息与关注记录会保留/);
  assert.equal(
    await confirmation
      .getByRole("button", { name: "移除", exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(249, 114, 100)",
  );
  assert.equal(
    (
      await confirmation
        .getByRole("button", { name: "移除", exact: true })
        .boundingBox()
    ).height,
    24,
  );
  await p.screenshot({ path: "/tmp/rah-member-remove-confirmation.png" });
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await row.waitFor();
  await search.focus();
  await p.mouse.move(200, 200);
  await remove.waitFor({ state: "hidden" });
  await row.focus();
  await remove.waitFor();
  await search.fill("no-matching-member");
  assert.equal(await page.locator(".rah-member-row").count(), 0);
  await search.fill("");
  await p.setViewportSize({ width: 390, height: 844 });
  await remove.waitFor();
  await p.screenshot({ path: "/tmp/rah-room-member-mobile.png" });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  let removeAttempts = 0;
  await p.route("**/v3/client/rooms/members/remove", async (route) => {
    removeAttempts++;
    if (removeAttempts === 1)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "fixture remove failed" } }),
      });
    else await route.continue();
  });
  await remove.click();
  await confirmation.waitFor();
  await confirmation.getByRole("button", { name: "移除", exact: true }).click();
  await confirmation.getByRole("alert").waitFor();
  await row.waitFor();
  await confirmation.getByRole("button", { name: "移除", exact: true }).click();
  await confirmation.waitFor({ state: "hidden" });
  assert.equal(removeAttempts, 2);
  assert.equal(await page.locator(".rah-member-row").count(), 0);
  await page.getByRole("button", { name: "添加成员", exact: true }).click();
  const candidates = p.locator(".rah-room-member-page.is-add");
  assert.equal(
    await candidates
      .getByRole("textbox", { name: "搜索成员" })
      .getAttribute("placeholder"),
    "名称",
  );
  const candidate = candidates.locator(".rah-room-add-candidate").first();
  await candidate.hover();
  await p.waitForTimeout(200);
  assert.equal(
    await candidate.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 212, 64)",
  );
  const footer = await candidates
    .getByRole("button", { name: /添加所选/ })
    .boundingBox();
  const area = await candidates.boundingBox();
  assert.ok(area.y + area.height - footer.y - footer.height <= 18);
  await p.screenshot({ path: "/tmp/rah-add-members-bottom.png" });
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  assert.equal(
    await drawer.evaluate((el) => getComputedStyle(el).animationDuration),
    "0.18s",
  );
  await drawer.waitFor({ state: "hidden" });
  console.log(
    "member search focus, bottom footer, admin-only labels, hover/focus/mobile remove and filtering passed",
  );
} finally {
  await b.close();
  await f.close();
}
