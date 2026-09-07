import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifySecondaryHeaders(page, origin, output, engine) {
  for (const surface of ["saved", "search"]) {
    for (const [width, height] of [
      [1440, 900],
      [1440, 598],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      // Resizing the preceding mobile route can reveal desktop-only labels and
      // start their fonts. Do not navigate away while that load is in flight.
      await page.evaluate(() => {
        document.body.getBoundingClientRect();
        return document.fonts.ready;
      });
      await page.goto(`${origin}/?surface=${surface}`, {
        waitUntil: "load",
      });
      const header = page.locator(
        surface === "saved" ? ".rah-saved-header" : ".search-top",
      );
      await header.waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        (await header.boundingBox()).height,
        height <= 600 ? 48 : 62,
        `${surface} shared track`,
      );
      assert.equal(
        await header.evaluate((e) => getComputedStyle(e).paddingLeft),
        "20px",
      );
      if (width > 767)
        assert.equal(
          (await header.locator(".rah-panel-header-icon").boundingBox()).width,
          36,
        );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      if (surface === "search") {
        const input = page.getByRole("textbox", {
          name: "搜索频道、私信、消息",
        });
        await input.fill("header-test");
        await input.evaluate((e) =>
          e.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              isComposing: true,
            }),
          ),
        );
        assert.equal(
          await input.inputValue(),
          "header-test",
          "IME Escape cannot clear the draft",
        );
        const clear = page.getByRole("button", {
          name: "清除搜索",
          exact: true,
        });
        assert.equal((await clear.boundingBox()).width, 24);
        assert.equal(
          await clear.locator("svg").evaluate((e) => getComputedStyle(e).width),
          "12px",
        );
        await clear.click();
        assert.equal(await input.inputValue(), "");
        assert.equal(
          await input.evaluate((e) => document.activeElement === e),
          true,
        );
        await input.fill("escape-query");
        await page.keyboard.press("Escape");
        assert.equal(await input.inputValue(), "");
        assert.equal(new URL(page.url()).searchParams.get("surface"), "search");
        if (width === 390)
          assert.equal(await page.locator(".search-kbd").isVisible(), false);
      }
      await page.screenshot({
        path: join(output, `${engine}-${surface}-${width}-${height}.png`),
      });
      if (width === 390) {
        const back = page.getByRole("button", {
          name: surface === "saved" ? "返回主页" : "返回聊天",
          exact: true,
        });
        assert.equal((await back.boundingBox()).width, 28);
        await back.click();
        await page.locator(".rah-room-sidebar").waitFor();
      }
    }
  }
}
