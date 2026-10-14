// FIXTURE ONLY: real temporary Core; navigation performs no provider execution.
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
export async function verifyGlobalNavigation({ browser, origin, channel }) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${origin}/?room=${channel.roomId}`);
    const nav = page.getByRole("navigation", { name: "主导航" });
    await nav.waitFor();
    await page.locator("textarea").fill("FIXTURE unsent navigation draft");
    for (const [id, label] of [
      ["search", "搜索"],
      ["agents", "Agent"],
      ["tasks", "任务"],
      ["activity", "动态"],
      ["settings", "设置"],
    ]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("view"), id);
      assert.equal(
        await nav
          .getByRole("button", { name: label, exact: true })
          .getAttribute("aria-current"),
        "page",
      );
      await page
        .getByText("页面骨架已就位，内容尚未接入。", { exact: true })
        .waitFor();
      assert.equal(await page.locator("textarea").isVisible(), false);
      assert.equal(
        await page
          .getByRole("link", { name: "打开临时控制台", exact: true })
          .getAttribute("href"),
        "/_rah/console/",
      );
    }
    await nav.getByRole("button", { name: "频道", exact: true }).click();
    await page.locator("textarea").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("textarea").inputValue(),
      "FIXTURE unsent navigation draft",
    );
    assert.equal(new URL(page.url()).searchParams.get("room"), channel.roomId);
    await page.mouse.move(viewport.width - 12, 100);
    await page.screenshot({
      path: join(tmpdir(), `loom-official-shell-channel-${viewport.width}.png`),
      animations: "disabled",
    });
    await nav.getByRole("button", { name: "Agent", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Agent", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Agent", exact: true }).waitFor();
    await page.mouse.move(viewport.width - 12, 100);
    await page.screenshot({
      path: join(tmpdir(), `loom-official-shell-agents-${viewport.width}.png`),
      animations: "disabled",
    });
    await nav.getByRole("button", { name: "任务", exact: true }).click();
    await page.goBack();
    await page.getByRole("heading", { name: "Agent", exact: true }).waitFor();
    await page.goForward();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    for (const label of ["搜索", "频道", "动态", "任务", "Agent", "设置"]) {
      const b = await nav
        .getByRole("button", { name: label, exact: true })
        .boundingBox();
      assert.ok(
        b &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= viewport.width &&
          b.y + b.height <= viewport.height,
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    results.push({
      viewport,
      allSixDestinations: true,
      urlReloadAndBackForward: true,
      keyboardNavigation: true,
      channelDraftPreservedAcrossPages: true,
      placeholdersExplicit: true,
      visiblePointerTargets: true,
      noHorizontalOverflow: true,
      externalRequests: 0,
    });
    await context.close();
  }
  return results;
}
