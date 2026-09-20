import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, firefox, expect } from "playwright/test";
const server = await createServer({
  root: "apps/web",
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(
          server.resolvedUrls.local[0] +
            "test/choice-row-fixture.html?mention&ranking",
        );
        const input = page.getByRole("textbox", { name: "提及输入" });
        const options = page.getByRole("option");
        await input.fill("@");
        await expect(options).toHaveCount(40);
        await input.fill("@doc");
        await expect(options).toHaveCount(30);
        await input.fill("@lyl");
        await expect(options).toHaveCount(1);
        await expect(options).toContainText("李云龙");
        await input.press("Enter");
        await expect(input).toHaveValue("@agent-2 ");
        await page.waitForTimeout(50); // Completion restores focus/caret on the next animation frame.
        await input.fill("@parity");
        await expect(options).toHaveCount(2);
        await expect(options.nth(0)).toContainText("@Parity");
        await input.press("ArrowDown");
        await input.press("Tab");
        await expect(input).toHaveValue("@parity ");
        await page.waitForTimeout(50); // Completion restores focus/caret on the next animation frame.
        await input.fill("#General");
        await expect(options).toHaveCount(1);
        await options.click();
        await expect(input).toHaveValue("#all ");
        await page.waitForTimeout(50); // Completion restores focus/caret on the next animation frame.
        await input.fill("#yfzx");
        await expect(options).toHaveCount(1);
        await input.press("Enter");
        await expect(input).toHaveValue("#研发中心 ");
        await page.waitForTimeout(50); // Completion restores focus/caret on the next animation frame.
        await input.fill("#old");
        await expect(options).toContainText("已归档");
        await input.press("Escape");
        await expect(options).toHaveCount(0);
        await input.fill("@agent");
        await expect(options).toHaveCount(30);
        for (let i = 0; i < 29; i++) await input.press("ArrowDown");
        assert.ok(
          await options.last().evaluate((el) => {
            const a = el.getBoundingClientRect(),
              b = el.parentElement.getBoundingClientRect();
            return a.bottom <= b.bottom + 1;
          }),
        );
        await page.screenshot({
          path: `/tmp/composer-ranking-${engine.name()}-${width}.png`,
        });
        await page.reload();
        await input.fill("@liyunlong");
        await expect(options).toContainText("李云龙");
      }
    } finally {
      await browser.close();
    }
  }
  console.log(
    "PASS @/# fields, pinyin, identity case, caps, keyboard, scroll, reload desktop/mobile Chromium/Firefox",
  );
} finally {
  await server.close();
}
