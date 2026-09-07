import assert from "node:assert/strict";

const fixtureUrl = (origin, mobile = false) =>
  `${origin}/test/ui-foundations.html?workspace-switcher-fixture${mobile ? "&mobile" : ""}`;

export async function verifyWorkspaceSwitcherFamily(page, origin) {
  await page.goto(fixtureUrl(origin), { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "rah:workspace-switcher:v1:fixture-human:order",
      JSON.stringify(["workspace-gamma", "workspace-alpha"]),
    );
    localStorage.setItem(
      "rah:workspace-switcher:v1:fixture-human:location:workspace-beta",
      "?surface=tasks",
    );
  });
  await page.reload({ waitUntil: "load" });

  const trigger = page.locator(".rah-space-mark");
  const menu = page.getByRole("menu", { name: "切换协作空间" });
  await trigger.click();
  await menu.waitFor();
  assert.equal(
    await menu.evaluate((node) => node === document.activeElement),
    true,
  );
  assert.deepEqual(
    await menu.evaluate((node) => {
      const menuBounds = node.getBoundingClientRect();
      const triggerBounds = document
        .querySelector(".rah-space-mark")
        .getBoundingClientRect();
      return {
        leftGap: menuBounds.left - triggerBounds.right,
        maxHeight: getComputedStyle(node).maxHeight,
        topOffset: menuBounds.top - triggerBounds.top,
        width: menuBounds.width,
      };
    }),
    { leftGap: 8, maxHeight: "884px", topOffset: 4, width: 256 },
  );
  const rows = menu.getByRole("menuitemradio");
  assert.equal(await rows.count(), 3);
  assert.match(
    (await rows.first().textContent()) ?? "",
    /very long Workspace/u,
  );
  assert.equal(
    await rows
      .filter({ hasText: "Alpha Workspace" })
      .getAttribute("aria-checked"),
    "true",
  );
  assert.equal(
    await rows
      .first()
      .locator(".rah-space-switcher-copy > b")
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return style.overflow === "hidden" && style.textOverflow === "ellipsis";
      }),
    true,
  );

  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.querySelector(".rah-space-mark") === document.activeElement,
  );
  assert.equal(
    await trigger.evaluate((node) => node === document.activeElement),
    true,
  );
  await trigger.click();
  await page.locator("[data-workspace-outside]").click();
  await menu.waitFor({ state: "detached" });

  await trigger.click();
  const handles = menu.locator(".rah-space-switcher-drag");
  const first = await handles.nth(0).boundingBox();
  const last = await handles.nth(2).boundingBox();
  assert.ok(first && last);
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="menuitemradio"]')
        ?.textContent?.includes("Beta Workspace") === true,
  );
  await page.reload({ waitUntil: "load" });
  await trigger.click();
  await menu.waitFor();
  assert.match((await rows.first().textContent()) ?? "", /Beta Workspace/u);

  await rows.filter({ hasText: "Beta Workspace" }).click();
  const output = page.locator("[data-workspace-selection]");
  assert.equal(await output.getAttribute("data-selected"), "workspace-beta");
  assert.equal(await output.getAttribute("data-remembered"), "?surface=tasks");
  assert.equal(await output.getAttribute("data-navigation-mode"), "restore");
  await trigger.click();
  await menu.getByRole("menuitem", { name: "管理当前协作空间" }).click();
  const dialog = page.getByRole("dialog", { name: "协作空间" });
  await dialog.waitFor();
  assert.equal(
    await menu.count(),
    0,
    "management is a separate dialog, not nested menu state",
  );
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.querySelector(".rah-space-mark") === document.activeElement,
  );
  assert.equal(
    await trigger.evaluate((node) => node === document.activeElement),
    true,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixtureUrl(origin, true), { waitUntil: "load" });
  const mobileTrigger = page.locator(".rah-mobile-space-mark");
  const mobileMenu = page.locator("#rah-mobile-workspace-switcher");
  await mobileTrigger.click();
  await mobileMenu.waitFor();
  assert.deepEqual(
    await mobileMenu.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return {
        fits: bounds.left >= 0 && bounds.right <= innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        width: bounds.width,
      };
    }),
    { fits: true, scrollWidth: 390, width: 374 },
  );
  await mobileMenu
    .getByRole("menuitemradio")
    .filter({ hasText: "Beta Workspace" })
    .click();
  assert.equal(await output.getAttribute("data-selected"), "workspace-beta");
  assert.equal(
    await output.getAttribute("data-remembered"),
    "",
    "mobile selection returns Home instead of restoring a desktop detail URL",
  );
  assert.equal(
    await output.getAttribute("data-navigation-mode"),
    "replace-with-home",
  );
  await mobileTrigger.click();
  await page.keyboard.press("Escape");
  await mobileMenu.waitFor({ state: "detached" });
  await page.waitForFunction(
    () =>
      document.querySelector(".rah-mobile-space-mark") ===
      document.activeElement,
  );
  assert.equal(
    await mobileTrigger.evaluate((node) => node === document.activeElement),
    true,
  );
}
