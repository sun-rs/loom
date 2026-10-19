import assert from "node:assert/strict";
export async function verifyComposerSuggestions({
  browser,
  origin,
  channels,
  instanceNames,
}) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    let writes = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (/\/(messages\/post|tasks\/create)$/.test(new URL(r.url()).pathname))
        writes++;
    });
    await page.goto(`${origin}/?room=${channels[2].roomId}`);
    const input = page.getByTestId("composer-textarea");
    await input.waitFor();
    await input.fill("@Fixture");
    const popup = page.getByTestId("mention-autocomplete-popover");
    await popup.waitFor();
    const rows = popup.locator("[data-ac-index]");
    assert.ok((await rows.count()) >= 2);
    await input.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    assert.equal(await input.inputValue(), "@Fixture");
    assert.ok(await popup.isVisible());
    await input.press("ArrowDown");
    await popup
      .locator('[data-ac-index="1"][data-highlighted="true"]')
      .waitFor();
    await input.press("Tab");
    const inserted = await input.inputValue();
    assert.ok(instanceNames.some((n) => inserted === `@${n} `));
    assert.ok((await input.inputValue()).startsWith("@Fixture"));
    assert.notEqual(await input.inputValue(), "@Fixture");
    await popup.waitFor({ state: "hidden" });
    await input.fill("@Fixture");
    await popup.waitFor();
    await input.press("Escape");
    await popup.waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), "@Fixture");
    await input.fill("#FIXTURE");
    const channelPopup = page.getByTestId("channel-autocomplete-popover");
    await channelPopup.waitFor();
    await channelPopup.locator("[data-ac-index]").first().click();
    assert.ok((await input.inputValue()).startsWith("#FIXTURE"));
    assert.equal(
      await input.evaluate((e) => document.activeElement === e),
      true,
    );
    await input.fill("FIXTURE draft");
    await input.press("Shift+Enter");
    assert.equal(await input.inputValue(), "FIXTURE draft\n");
    const task = page.getByTestId("composer-as-task-toggle");
    await task.click();
    assert.equal(await task.getAttribute("aria-checked"), "true");
    assert.equal(
      await input.evaluate((e) => document.activeElement === e),
      true,
    );
    await task.click();
    const file = page.getByRole("button", {
      name: "引用计算机文件或文件夹",
      exact: true,
    });
    await file.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "引用计算机文件或文件夹",
    );
    assert.equal(await input.inputValue(), "FIXTURE draft\n");
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    results.push({
      viewport,
      mentionKeyboardAndIME: true,
      channelPointer: true,
      taskFocus: true,
      fileCloseFocus: true,
      noSends: true,
    });
    await context.close();
  }
  return { fixture: true, results };
}
