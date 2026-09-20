import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  let refreshes = 0;
  await p.route("**/v1/local/runtimes/list", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const runtime of data.runtimes) {
      runtime.customModelRuntime = "codex";
      for (const model of runtime.modelBindingDescriptors)
        model.supportedServiceTiers = ["default", "priority"];
    }
    if (route.request().postDataJSON()?.refreshOfferId) {
      refreshes++;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "fixture catalog unavailable" },
        }),
      });
    } else await route.fulfill({ response, json: data });
  });
  await p.goto(f.origin + "/?surface=agents");
  const rows = p.locator(
    ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
  );
  await rows.first().waitFor();
  const a = await rows.nth(0).boundingBox(),
    c = await rows.nth(1).boundingBox();
  assert.equal(c.y - a.y - a.height, 4);
  await rows.first().click();
  await p.locator(".rah-agent-head-actions button").first().hover();
  await p
    .getByRole("tooltip", { name: "聊天", exact: true })
    .waitFor({ timeout: 3000 });
  await p.getByRole("button", { name: "编辑运行时配置", exact: true }).click();
  const dialog = p.getByRole("dialog", { name: "编辑运行时配置" });
  await dialog.getByRole("button", { name: /^模型：/ }).click();
  await p.getByRole("menuitemradio").first().click();
  await dialog.getByRole("button", { name: /^模型：/ }).click();
  await p.getByRole("menuitemradio", { name: "自定义", exact: true }).click();
  const custom = dialog.getByRole("textbox", {
    name: "自定义模型 ID",
    exact: true,
  });
  await custom.waitFor();
  assert.equal(await custom.getAttribute("placeholder"), "自定义模型 ID");
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 844 });
    const geometry = await custom.evaluate((el) => {
      const trigger = el
        .closest(".rah-runtime-edit-field")
        .querySelector(".task-filter-trigger");
      return {
        height: el.getBoundingClientRect().height,
        otherHeight: trigger.getBoundingClientRect().height,
        font: getComputedStyle(el).fontSize,
        otherFont: getComputedStyle(trigger).fontSize,
      };
    });
    assert.equal(
      geometry.height,
      geometry.otherHeight,
      JSON.stringify(geometry),
    );
    assert.equal(geometry.font, geometry.otherFont);
  }
  await p.setViewportSize({ width: 1440, height: 900 });

  await dialog
    .getByRole("button", { name: "模型：自定义", exact: true })
    .click();
  await p.getByRole("menuitemradio").first().click();
  assert.equal(await custom.count(), 0);
  await dialog.getByRole("checkbox", { name: "快速模式" }).waitFor();
  await dialog.getByRole("button", { name: "刷新模型", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(refreshes, 1);
  assert.equal(
    await dialog
      .getByRole("button", { name: /^模型：/ })
      .evaluate(
        (el) =>
          el
            .closest(".rah-runtime-edit-field")
            .querySelectorAll(":scope > small").length,
      ),
    0,
    "model selector must not render a raw ID caption below the control",
  );
  const fastBox = await dialog
    .getByRole("checkbox", { name: "快速模式" })
    .boundingBox();
  assert.equal(fastBox.width, 16);
  assert.equal(fastBox.height, 16);
  const fastCard = dialog.locator(".rah-runtime-fast-mode");
  const cardBox = await fastCard.boundingBox();
  assert.ok(
    await dialog.evaluate(
      (el) =>
        el.querySelector(".rah-agent-launch-settings").getBoundingClientRect()
          .top -
          el.querySelector(".rah-runtime-fast-mode").getBoundingClientRect()
            .bottom >=
        16,
    ),
    "runtime edit retains a field gap before More",
  );
  assert.ok(cardBox.height >= 64, "fast mode is an option card");
  const fast = dialog.getByRole("checkbox", { name: "快速模式", exact: true });
  await fastCard.click({
    position: { x: cardBox.width - 12, y: cardBox.height - 12 },
  });
  assert.equal(await fast.isChecked(), true);
  await fastCard.click({
    position: { x: cardBox.width - 12, y: cardBox.height - 12 },
  });
  assert.equal(await fast.isChecked(), false);
  await fast.focus();
  await p.keyboard.press("Space");
  assert.equal(await fast.isChecked(), true);
  assert.equal(
    await fast.evaluate((e) => getComputedStyle(e).backgroundColor),
    await fast.evaluate((e) => {
      const s = document.createElement("i");
      s.style.background = "var(--ink)";
      e.parentElement.append(s);
      const c = getComputedStyle(s).backgroundColor;
      s.remove();
      return c;
    }),
  );
  assert.equal(
    await fastCard
      .locator(".rah-runtime-fast-check > svg")
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 255)",
  );
  await fastCard.locator("span[id]").dblclick();
  assert.equal(
    await p.evaluate(() => window.getSelection()?.toString()),
    "",
    "double clicking option-card text must not select it",
  );
  await fast.check();
  await p.screenshot({ path: "/tmp/rah-fast-mode-card.png" });
  assert.equal(
    await fastCard.locator(".rah-runtime-fast-check > svg").isVisible(),
    true,
  );
  await p.setViewportSize({ width: 390, height: 844 });
  const narrow = await fastCard.boundingBox();
  await fastCard.click({
    position: { x: narrow.width - 10, y: narrow.height - 10 },
  });
  assert.equal(await fast.isChecked(), false);
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  await p.screenshot({ path: "/tmp/rah-fast-mode-card-mobile.png" });
  await p.setViewportSize({ width: 1440, height: 900 });
  await fast.uncheck();
  let savedPolicy;
  await p.route("**/v3/client/agents/manage", async (route) => {
    savedPolicy = route.request().postDataJSON().modelIntent;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "fixture save rejected" } }),
    });
  });
  await dialog.getByRole("checkbox", { name: "快速模式" }).check();
  await Promise.all([
    p.waitForResponse((response) =>
      response.url().endsWith("/v3/client/agents/manage"),
    ),
    dialog.getByRole("button", { name: "保存运行时配置", exact: true }).click(),
  ]);
  assert.equal(savedPolicy.serviceTier, "priority");
  assert.equal(savedPolicy.exactBindingIds.length, 1);

  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await p.getByRole("button", { name: "关系图", exact: true }).click();
  await p.locator(".rah-member-graph-summary-row").first().waitFor();
  const geometry = await p
    .locator(".rah-member-graph-summary-row")
    .first()
    .evaluate((el) => {
      const count = el.lastElementChild;
      return {
        right:
          el.getBoundingClientRect().right -
          count.getBoundingClientRect().right,
        font: getComputedStyle(count).fontSize,
        alignment: getComputedStyle(el).textAlign,
      };
    });
  assert.ok(geometry.right < 2);
  assert.equal(geometry.font, "12px");
  assert.equal(geometry.alignment, "left");
  await p
    .locator(".rah-agent-human-section .rah-agent-member-row")
    .first()
    .click();
  await p.getByRole("region", { name: "Human 详情", exact: true }).waitFor();
  assert.equal(await p.locator(".rah-agent-peek").count(), 0);
  assert.equal(new URL(p.url()).searchParams.get("surface"), "agents");
  assert.equal(new URL(p.url()).searchParams.get("memberView"), "human");
  await p.screenshot({ path: "/tmp/rah-member-details-desktop.png" });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: "/tmp/rah-member-details-mobile.png" });
  console.log("member row spacing, header tooltip and graph alignment passed");
} finally {
  await b.close();
  await f.close();
}
