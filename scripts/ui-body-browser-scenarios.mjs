import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifySearchHomeBody(page, origin, output, engine) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`${origin}/?surface=search`, { waitUntil: "load" });
    const stage = page.locator(".search-stage");
    await stage.waitFor();
    // Earlier header scenarios can finish a real debounced search. Establish
    // the no-history precondition via the actual clear action in this isolated
    // test context, instead of relying on request timing between scenarios.
    const priorSuggestions = page.locator(".rah-search-suggestions");
    if (await priorSuggestions.count()) {
      await priorSuggestions
        .getByRole("button", { name: "清除", exact: true })
        .click();
    }
    const title = page.getByText("搜索所有内容", { exact: true });
    await title.waitFor();
    const box = await stage.boundingBox();
    const titleBox = await title.boundingBox();
    assert.ok(
      Math.abs(titleBox.y + titleBox.height / 2 - (box.y + box.height / 2)) <
        55,
      "Search home empty content is centered in the remaining stage, not its intrinsic wrapper",
    );
    assert.equal(
      await title.evaluate((e) => getComputedStyle(e).fontSize),
      "14px",
    );
    await page.screenshot({
      path: join(output, `${engine}-search-body-${width}.png`),
    });
  }
  // This helper runs in a disposable browser context. Exercise the real search
  // callback/history branch; never seed a parallel fake UI store.
  const input = page.getByRole("textbox", { name: "搜索频道、私信、消息" });
  await input.fill("body-contract-query");
  await page.locator(".rah-search-count").waitFor();
  await page.getByRole("button", { name: "清除搜索", exact: true }).click();
  const suggestions = page.locator(".rah-search-suggestions");
  await suggestions.waitFor();
  assert.equal(
    await page.getByText("搜索所有内容", { exact: true }).count(),
    0,
    "suggestions replace, rather than stack beneath, the initial empty state",
  );
  await suggestions.getByRole("button", { name: "清除", exact: true }).click();
  await page.getByText("搜索所有内容", { exact: true }).waitFor();
}

export async function verifyBodyMatrix(page, output, engine) {
  for (const width of [1440, 768, 767, 701, 700, 640, 639, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const pane = page.locator('[data-fixture="activity-body"]');
    await page.getByRole("button", { name: "body:empty", exact: true }).click();
    const empty = pane.locator(".rah-empty-state");
    assert.equal(await empty.count(), 1);
    assert.equal(await pane.locator("header").count(), 1);
    assert.equal(await pane.locator(".rah-agent-activity-note").count(), 0);
    const parentBox = await pane.boundingBox();
    const headerBox = await pane.locator("header").boundingBox();
    const contentBox = await empty
      .locator(".rah-empty-state-content")
      .boundingBox();
    assert.ok(
      Math.abs(
        contentBox.y +
          contentBox.height / 2 -
          (parentBox.y + parentBox.height + headerBox.y + headerBox.height) / 2,
      ) < 2,
    );
    assert.equal(
      await empty.locator("svg").evaluate((e) => getComputedStyle(e).width),
      "36px",
    );
    assert.equal(
      await empty
        .locator(".rah-empty-state-title")
        .evaluate((e) => getComputedStyle(e).fontSize),
      "18px",
    );
    for (const state of ["loading", "error"]) {
      await page
        .getByRole("button", { name: `body:${state}`, exact: true })
        .click();
      assert.equal(
        await empty.count(),
        0,
        `${state} must not claim there is no activity`,
      );
      assert.equal(
        await pane
          .getByText(state === "loading" ? "正在读取活动…" : "没有读取权限", {
            exact: true,
          })
          .count(),
        1,
      );
    }
    await page.getByRole("button", { name: "body:empty", exact: true }).click();
    const cards = page.locator('[data-fixture="entity-cards"]');
    const enabled = cards.locator("button.rah-entity-card:not(:disabled)");
    const disabled = cards.locator("button:disabled");
    await enabled.scrollIntoViewIfNeeded();
    await enabled.evaluate((e) => e.blur());
    await page.mouse.move(0, 0);
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-fixture="entity-cards"] button:not(:disabled)',
          ),
        ).borderTopColor === "rgba(0, 0, 0, 0.3)",
    );
    const rest = await enabled.evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        border: s.borderTopWidth,
        color: s.borderTopColor,
        padding: s.padding,
        gap: s.gap,
      };
    });
    assert.equal(rest.border, "2px");
    assert.equal(rest.color, "rgba(0, 0, 0, 0.3)");
    assert.equal(rest.padding, "8px 12px");
    assert.equal(rest.gap, "12px");
    assert.equal(await enabled.locator(".rah-agent-status-dot").count(), 1);
    const avatar = await enabled.locator(".rah-agent-avatar").evaluate((e) => ({
      width: getComputedStyle(e).width,
      border: getComputedStyle(e).borderTopWidth,
    }));
    assert.deepEqual(
      avatar,
      { width: "32px", border: "2px" },
      "surface-list avatar is not the smaller member-row variant",
    );
    assert.equal(
      await enabled.locator(".rah-agent-avatar .rah-agent-status-dot").count(),
      0,
    );
    assert.equal(
      await enabled
        .locator(".rah-entity-card-name")
        .evaluate((e) => getComputedStyle(e).fontSize),
      "14px",
    );
    assert.equal(
      await enabled
        .locator(".rah-entity-card-subtitle")
        .evaluate((e) => getComputedStyle(e).fontSize),
      "12px",
    );
    assert.equal(
      await enabled.locator(".rah-entity-card-status-label").isVisible(),
      width >= 640,
    );
    await enabled.hover();
    assert.ok(
      (await enabled.evaluate((e) => getComputedStyle(e).boxShadow)).includes(
        "2px 2px",
      ),
    );
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    await enabled.focus();
    assert.ok(
      (await enabled.evaluate((e) => getComputedStyle(e).boxShadow)).includes(
        "2px 2px",
      ),
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await cards.locator("[data-opened]").textContent(),
      "fixture-agent",
    );
    assert.equal(await disabled.isDisabled(), true);
    await disabled.evaluate((e) => e.click());
    await page.keyboard.press("Space");
    assert.equal(
      await cards.locator("[data-opened]").textContent(),
      "fixture-agent",
    );
    const geometry = await enabled.evaluate((e) => ({
      width: e.clientWidth,
      scroll: e.scrollWidth,
    }));
    assert.ok(
      geometry.scroll <= geometry.width + 1,
      "long names stay within the card",
    );
    if ([1440, 390].includes(width)) {
      await pane.screenshot({
        path: join(output, `${engine}-activity-empty-${width}.png`),
      });
      await cards.screenshot({
        path: join(output, `${engine}-entity-card-states-${width}.png`),
      });
    }
  }
}
