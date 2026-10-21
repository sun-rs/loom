import assert from "node:assert/strict";
export async function verifyLocalFonts({ browser, origin }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
    });
    try {
      const page = await context.newPage(),
        requests = [],
        errors = [];
      page.on("request", (r) => {
        if (/fonts\.(googleapis|gstatic)\.com/.test(r.url()))
          requests.push(r.url());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?view=settings&settings=appearance");
      await page.getByTestId("appearance-theme-picker").waitFor();
      const loaded = await page.evaluate(async () => {
        const results = [];
        for (const family of ["Space Grotesk", "Space Mono"]) {
          const faces = await document.fonts.load(
            `400 16px "${family}"`,
            'Abc123"',
          );
          if (!faces.length || faces.some((f) => f.status !== "loaded"))
            throw Error("Font unavailable: " + family);
          results.push({ family, loaded: faces.length });
        }
        return results;
      });
      const typography = [];
      for (const theme of ["light", "dark"]) {
        await page.getByTestId("appearance-mode-" + theme).click();
        await page.waitForFunction(
          (mode) => document.documentElement.classList.contains(mode),
          theme,
        );
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        const cdp = await context.newCDPSession(page);
        await cdp.send("DOM.enable");
        await cdp.send("CSS.enable");
        for (const [size, px] of [
          ["sm", 12],
          ["md", 14],
          ["lg", 16],
        ]) {
          await page.getByTestId("message-font-size-" + size).click();
          const preview = page
            .locator(
              '[aria-label="消息字号预览"] [data-slot="message-item-body"]',
            )
            .first();
          await preview.evaluate((el) => {
            const old = document.querySelector("#loom-font-probe");
            old?.remove();
            const span = document.createElement("span");
            span.id = "loom-font-probe";
            span.textContent = "中文字体测试 English ABC 123";
            el.append(span);
          });
          await page.evaluate(() => document.fonts.ready);
          const metrics = await page
            .locator("#loom-font-probe")
            .evaluate((el) => ({
              fontSize: getComputedStyle(el).fontSize,
              fontFamily: getComputedStyle(el).fontFamily,
            }));
          assert.equal(metrics.fontSize, (width >= 768 ? px - 2 : px) + "px");
          const { root } = await cdp.send("DOM.getDocument");
          const { nodeId } = await cdp.send("DOM.querySelector", {
            nodeId: root.nodeId,
            selector: "#loom-font-probe",
          });
          const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", {
            nodeId,
          });
          assert.ok(fonts.some((f) => f.isCustomFont && f.glyphCount > 0));
          assert.ok(fonts.some((f) => !f.isCustomFont && f.glyphCount > 0));
          typography.push({ theme, size, ...metrics, fonts });
          await page.locator("#loom-font-probe").evaluate((el) => el.remove());
        }
        await cdp.detach();
        await page.screenshot({
          path: `/tmp/loom-local-fonts-${theme}-${width}.png`,
        });
      }
      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
      results.push({
        width,
        dpr: 1,
        loaded,
        typography,
        externalFontRequests: requests.length,
        pageErrors: errors.length,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
