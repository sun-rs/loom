import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

process.env.RAH_FIXTURE_COMPOSER_FILES = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
    await page.getByLabel("添加引用或附件", { exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "引用计算机文件或文件夹" });
    const confirm = dialog.getByRole("button", {
      name: "引用所选",
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    const host = dialog.getByLabel("计算机", { exact: true });
    const path = dialog.locator(".rah-computer-file-path code");
    const originalHost = await host.textContent();
    const homePath = await path.textContent();
    const header = await dialog.locator("header").boundingBox();
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let intercepted;
    const arrived = new Promise((resolve) => {
      intercepted = resolve;
    });
    await page.route("**/v3/client/computers/files/list", async (route) => {
      if (route.request().postDataJSON().path !== "Folder with spaces")
        return route.continue();
      intercepted();
      await held;
      await route.continue().catch(() => {});
    });
    await dialog
      .getByRole("button", {
        name: "打开文件夹 Folder with spaces",
        exact: true,
      })
      .click();
    await arrived;
    try {
      await expect(host).toHaveText(originalHost);
      await expect(path).toHaveText(`${homePath}/Folder with spaces`);
      assert.deepEqual(
        await dialog.locator("header").boundingBox(),
        header,
        "Loading must not move the dialog header",
      );
      await expect(confirm).toBeDisabled();
      await expect(
        dialog.getByRole("button", {
          name: "打开文件夹 Folder with spaces",
          exact: true,
        }),
      ).toHaveCount(0);
      // Leave a slow request through Home; its late result must not overwrite Home.
      await dialog.getByLabel("返回用户主目录", { exact: true }).click();
      await expect(path).toHaveText(homePath);
      await expect(confirm).toBeEnabled();
    } finally {
      release();
    }
    await page.unrouteAll({ behavior: "wait" });
    await expect(path).toHaveText(homePath);
    await expect(
      dialog.getByRole("button", {
        name: "打开文件夹 Folder with spaces",
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole("button", {
        name: "打开文件夹 Folder with spaces",
        exact: true,
      })
      .click();
    await expect(confirm).toBeEnabled();
    await expect(path).toHaveText(`${homePath}/Folder with spaces`);
    await expect(host).toHaveText(originalHost);
    await expect(
      dialog.getByRole("button", { name: "note.txt", exact: true }),
    ).toBeVisible();
    assert.equal(
      await path.getAttribute("title"),
      `${homePath}/Folder with spaces`,
    );
    await page.close();
  }
  console.log(
    "Directory transitions preserve host/absolute path; pending references and stale responses fenced (1440/390).",
  );
} finally {
  await browser.close();
  await fixture.close();
}
