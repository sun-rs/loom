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
        for (const family of [
          "Geist",
          "Geist Mono",
          "Hanken Grotesk",
          "Inter",
          "Raft Quote Glyphs",
        ]) {
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
      for (const theme of ["elegant", "brutal"]) {
        await page
          .getByTestId("appearance-light-theme-" + theme)
          .locator("..")
          .locator("[data-theme]")
          .first()
          .click();
        await page.waitForFunction(
          (theme) => document.documentElement.dataset.theme === theme,
          theme,
        );
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
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
        externalFontRequests: requests.length,
        pageErrors: errors.length,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
