import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture(),
  browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.route("**/v1/local/runtimes/list", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    for (const runtime of data.runtimes) {
      runtime.customModelRuntime = process.env.RAH_CUSTOM_RUNTIME ?? "codex";
      for (const model of runtime.modelBindingDescriptors)
        model.supportedServiceTiers = ["default", "priority"];
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto(fixture.origin + "/?surface=agents");
  await page.getByRole("button", { name: "添加 Agent", exact: true }).click();
  await page.getByRole("menuitem", { name: "创建 Agent", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建 AGENT", exact: true });
  await dialog.getByRole("button", { name: /^运行时：/ }).click();
  await page.getByRole("menuitemradio").first().click();
  await expect(
    dialog.getByRole("checkbox", { name: "快速模式", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: /^模型：/ }).click();
  await page.getByRole("menuitemradio").first().click();
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
  const fast = dialog.getByRole("checkbox", { name: "快速模式", exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await fast.scrollIntoViewIfNeeded();
    const spacing = await dialog.evaluate(
      (el) =>
        el.querySelector(".rah-agent-launch-settings").getBoundingClientRect()
          .top -
        el.querySelector(".rah-runtime-fast-mode").getBoundingClientRect()
          .bottom,
    );
    assert.ok(spacing >= 16, `fast mode / more gap: ${spacing}`);
    const box = await fast.boundingBox();
    assert.equal(box.width, 16);
    assert.equal(box.height, 16);
    await fast.check();
    await expect(fast).toBeChecked();
    await fast.focus();
    await page.keyboard.press("Space");
    await expect(fast).not.toBeChecked();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    await page.screenshot({ path: `/tmp/create-fast-${width}.png` });
  }
  await dialog.getByRole("button", { name: /^模型：/ }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "自定义", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("menuitemradio", { name: "自定义", exact: true })
    .click();
  const customInput = dialog.getByRole("textbox", {
    name: "自定义模型 ID",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "模型：自定义", exact: true }),
  ).toBeVisible();
  await expect(customInput).toHaveAttribute("placeholder", "自定义模型 ID");
  assert.equal(
    await customInput.locator("..").evaluate((el) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim(),
    ),
    "",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await customInput.focus();
    await dialog
      .getByRole("button", { name: "模型：自定义", exact: true })
      .hover();
    await page.waitForTimeout(180);
    const geometry = await customInput.evaluate((el) => {
      const input = el.getBoundingClientRect();
      const trigger = el
        .closest(".rah-runtime-edit-field")
        .querySelector(".task-filter-trigger")
        .getBoundingClientRect();
      return {
        gap: trigger.top - input.bottom,
        heightDelta: Math.abs(trigger.height - input.height),
        font: getComputedStyle(el).fontSize,
        delta: Math.abs(trigger.width - input.width),
      };
    });
    assert.ok(
      geometry.gap >= 6 && geometry.gap <= 12,
      JSON.stringify(geometry),
    );
    assert.ok(geometry.delta < 1);
    assert.ok(geometry.heightDelta < 1, JSON.stringify(geometry));
    assert.equal(geometry.font, "16px");
  }
  await page.screenshot({
    path: `/tmp/custom-picker-${process.env.RAH_CUSTOM_RUNTIME ?? "codex"}.png`,
  });
  await customInput.fill("vendor/custom-model");
  await expect(
    dialog.getByRole("button", { name: "模型：自定义", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "模型：自定义", exact: true })
    .click();
  await expect(
    page.getByRole("menuitemradio", { name: "自定义", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio").first().click();
  await expect(customInput).toHaveCount(0);
  console.log(
    "Create Agent fast checkbox geometry, pointer/keyboard, responsive and custom label passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
