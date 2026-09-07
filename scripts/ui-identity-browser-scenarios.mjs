import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyEntitySurfaces(page, origin, output, engine) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`${origin}/?surface=tasks`, { waitUntil: "load" });
    await page.locator(".rah-global-task-card").first().waitFor();
    for (const label of ["频道", "创建者", "负责人"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      const menu = page.getByRole("menu", { name: `${label}筛选` });
      const input = menu.getByRole("textbox");
      await input.focus();
      const style = await input.evaluate((element) => {
        const s = getComputedStyle(element);
        return {
          border: s.borderTopWidth,
          shadow: s.boxShadow,
          outline: s.outlineStyle,
        };
      });
      assert.equal(style.border, "2px");
      assert.ok(
        style.shadow.includes("4px 4px"),
        "focused input uses official hard shadow",
      );
      assert.equal(style.outline, "none");
      if (label !== "频道") {
        const sentinel = menu.getByRole("menuitemcheckbox", {
          name: label === "创建者" ? "我创建的" : "分配给我的",
          exact: true,
        });
        await sentinel.waitFor();
        await menu.locator(".rah-agent-avatar-grid").first().waitFor();
        assert.equal(await sentinel.locator('[role="img"],svg').count(), 0);
        assert.equal(
          await sentinel.locator(".rah-discovery-option-leading").count(),
          1,
        );
        assert.ok(
          (await menu.locator('[role="img"]').count()) > 0,
          "real candidates keep actual identity avatars",
        );
        assert.ok(
          (await menu.locator(".rah-agent-avatar-grid").count()) > 0,
          "Agent rows without a saved avatar must share the canonical Agent fallback, not human initials",
        );
      } else assert.equal(await menu.locator('[role="img"]').count(), 0);
      await page.screenshot({
        path: join(output, `${engine}-task-${label}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      assert.equal(await menu.count(), 0);
    }
    await page.goto(`${origin}/?surface=computers`, {
      waitUntil: "load",
    });
    const card = page
      .locator(".rah-computer-agent-list button.rah-entity-card")
      .first();
    await card.waitFor();
    await page.mouse.move(0, 0);
    assert.equal(
      await card.evaluate((e) => getComputedStyle(e).borderTopWidth),
      "2px",
    );
    await card.hover();
    await page.waitForFunction(
      (e) =>
        /^(rgb\(0, 0, 0\)|oklch\(0 0 0\))$/.test(
          getComputedStyle(e).borderTopColor,
        ),
      await card.elementHandle(),
    );
    assert.match(
      await card.evaluate((e) => getComputedStyle(e).borderTopColor),
      /^(rgb\(0, 0, 0\)|oklch\(0 0 0\))$/,
    );
    await page.screenshot({
      path: join(output, `${engine}-computer-identity-${width}.png`),
    });
    assert.equal(await card.locator(".rah-agent-status-dot").count(), 1);
    assert.equal(await card.getByText("可用", { exact: true }).count(), 0);
    const name = await card.locator(".rah-entity-card-name").textContent();
    await card.click();
    const title = page.locator(".rah-agent-detail-identity h2");
    await title.waitFor();
    assert.equal(
      await title.textContent(),
      name,
      "card navigation retains exact entity identity",
    );
  }
}

export async function verifyStatusDots(page) {
  const dots = await page
    .locator('[data-fixture="status-dots"] i')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          size: element.dataset.size,
          radius: style.borderRadius,
          border: style.borderTopWidth,
          shrink: style.flexShrink,
          width: style.width,
          height: style.height,
        };
      }),
    );
  assert.equal(dots.length, 15);
  for (const dot of dots) {
    assert.equal(
      dot.radius,
      "50%",
      "status shape must not depend on its parent page",
    );
    assert.equal(dot.border, "1px");
    assert.equal(dot.shrink, "0");
    assert.equal(dot.width, { sm: "8px", md: "10px", lg: "11px" }[dot.size]);
    assert.equal(dot.height, dot.width);
  }
}
