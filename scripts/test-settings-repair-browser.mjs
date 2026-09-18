import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/runtime-guide-fixture.html?settingsSection=appearance",
    );
    const model = page
      .locator(".rah-settings-card")
      .filter({ has: page.locator("#rah-agent-model-label") });
    const hidden = page
      .locator(".rah-settings-card")
      .filter({ has: page.locator("#rah-hide-empty-label") });
    await hidden.waitFor();
    assert.equal(
      await model.evaluate((e) =>
        Boolean(e.nextElementSibling?.querySelector("#rah-hide-empty-label")),
      ),
      true,
    );
    await hidden.scrollIntoViewIfNeeded();
    const layout = await hidden.evaluate((e) => ({
      gap:
        e.getBoundingClientRect().top -
        e.previousElementSibling.getBoundingClientRect().bottom,
      border: getComputedStyle(e).borderTopWidth,
    }));
    assert.equal(layout.gap, 16);
    assert.equal(layout.border, "2px");
    const input = hidden.getByRole("checkbox");
    await input.uncheck();
    await input.hover();
    assert.equal(
      await input.evaluate((e) => getComputedStyle(e).cursor),
      "pointer",
    );
    assert.equal(
      await input.evaluate(
        (e) => getComputedStyle(e.nextElementSibling).backgroundColor,
      ),
      "rgba(255, 212, 64, 0.3)",
    );
    const rect = await input.boundingBox();
    for (const x of [2, rect.width - 2]) {
      const before = await input.isChecked();
      await page.mouse.click(rect.x + x, rect.y + rect.height / 2);
      assert.equal(await input.isChecked(), !before);
    }
    await input.check();
    assert.equal(
      await input.evaluate(
        (e) => getComputedStyle(e.nextElementSibling).backgroundColor,
      ),
      "rgb(255, 212, 64)",
    );
    await page.screenshot({ path: `/tmp/rah-settings-repair-${width}.png` });
    assert.equal(
      await page
        .locator(".rah-settings-navigation")
        .getByRole("button", { name: "计算机", exact: true })
        .count(),
      0,
    );
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/runtime-guide-fixture.html?settingsSection=server",
    );
    const archives = page.getByRole("region", { name: "已归档频道" });
    await archives.waitFor();
    await archives
      .getByRole("button", { name: "#Archived fixture", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.body.dataset.openedRoom),
      "archive-fixture",
    );
    await archives
      .getByRole("button", { name: "取消归档", exact: true })
      .click();
    await archives.getByRole("alert").waitFor();
    assert.match(await archives.innerText(), /Fixture denied/);
    await archives
      .getByRole("button", { name: "取消归档", exact: true })
      .click();
    await archives.waitFor({ state: "detached" });
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/runtime-guide-fixture.html?agentChat",
    );
    const chat = page.locator(".rah-agent-chat-pane");
    await chat.waitFor();
    assert.equal(await chat.locator(".rah-agent-chat-compose").count(), 0);
    for (const [id, label, icon] of [
      ["public", "公开", "hash"],
      ["private", "私有", "lock"],
    ]) {
      const row = chat.getByRole("button", {
        name: `打开 ${id === "public" ? "Public" : "Private"} fixture`,
        exact: true,
      });
      assert.equal(await row.locator("i").innerText(), label);
      assert.ok(
        (await row.locator("svg use").getAttribute("href")).endsWith(
          `-icon-${icon}`,
        ),
      );
      await row.click();
      assert.equal(
        await page.evaluate(() => document.body.dataset.openedRoom),
        id,
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
