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
      const p = await browser.newPage();
      for (const width of [1440, 390]) {
        await p.setViewportSize({ width, height: 844 });
        await p.goto(
          server.resolvedUrls.local[0] + "test/choice-row-fixture.html?mention",
        );
        const input = p.getByRole("textbox", { name: "提及输入" });
        await input.fill("");
        await input.fill("#");
        const menu = p.getByRole("listbox", { name: "引用频道" });
        await expect(menu).toBeVisible();
        const rows = menu.getByRole("option");
        await expect(rows).toHaveCount(3);
        const color = async (row) =>
          row.evaluate((el) => {
            const c = document.createElement("canvas").getContext("2d");
            c.fillStyle = getComputedStyle(el).backgroundColor;
            c.fillRect(0, 0, 1, 1);
            return [...c.getImageData(0, 0, 1, 1).data];
          });
        assert.deepEqual(await color(rows.nth(0)), [254, 125, 168, 255]);
        await rows.nth(1).hover();
        assert.deepEqual(await color(rows.nth(1)), [255, 212, 64, 255]);
        await expect(rows.nth(2)).toContainText("已归档");
        await rows.nth(2).hover();
        assert.deepEqual(await color(rows.nth(2)), [0, 0, 0, 13]);
        await rows.nth(2).click();
        await expect(input).toHaveValue("#old ");
        await expect(input).toBeFocused();
        await input.fill("");
        await input.fill("#");
        await input.press("ArrowDown");
        await input.press("Enter");
        await expect(input).toHaveValue("#test ");
        await input.fill("");
        await input.fill("#");
        await input.press("Escape");
        await expect(menu).toHaveCount(0);
        await input.fill("");
        await input.fill("#");
        await input.press("ArrowDown");
        await input.press("Tab");
        await expect(input).toHaveValue("#test ");
        await input.fill("");
        await input.fill("#");
        await input.dispatchEvent("keydown", {
          key: "Enter",
          isComposing: true,
          keyCode: 229,
        });
        await expect(input).toHaveValue("#");
        await input.press("Shift+Enter");
        await expect(input).toHaveValue("#\n");
        await input.fill("");
        await input.fill("#");
        await p.getByRole("heading").click();
        await expect(menu).toHaveCount(0);
        await input.fill("@agent-b");
        await p.getByRole("option").click();
        await expect(input).toHaveValue("@agent-b ");
        await input.fill("");
        await input.fill("#");
        await p.screenshot({
          path: `/tmp/channel-autocomplete-${engine.name()}-${width}.png`,
        });
      }
    } finally {
      await browser.close();
    }
  }
  console.log(
    "PASS channel keyboard/pointer completion, colors, archived references, Escape and Agent regression",
  );
} finally {
  await server.close();
}
